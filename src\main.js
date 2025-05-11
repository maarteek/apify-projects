const Apify = require('apify');
const { log } = Apify.utils;

Apify.main(async () => {
    const input = await Apify.getInput();
    const {
        searchQuery = '',
        maxListings = 50,
        includeDetails = true,
        proxy = { useApifyProxy: true },
    } = input;

    const requestQueue = await Apify.openRequestQueue();
    await requestQueue.addRequest({
        url: `https://www.example.com/search?q=${encodeURIComponent(searchQuery)}`,
    });

    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        proxyConfiguration: proxy,
        launchContext: {
            useChrome: true,
            stealth: true,
        },
        handlePageFunction: async ({ request, page }) => {
            const listings = await page.$$eval('.listing', (nodes) =>
                nodes.map((node) => ({
                    title: node.querySelector('.listing-title')?.textContent.trim(),
                    price: node.querySelector('.listing-price')?.textContent.trim(),
                    location: node.querySelector('.listing-location')?.textContent.trim(),
                    url: node.querySelector('a')?.href,
                }))
            );

            for (const listing of listings) {
                if (includeDetails) {
                    await requestQueue.addRequest({
                        url: listing.url,
                        userData: { listing },
                    });
                } else {
                    await Apify.pushData(listing);
                }
            }

            if (await requestQueue.getInfo().handledRequestCount >= maxListings) {
                log.info('Reached maximum number of listings. Finishing the crawl.');
                return;
            }

            const nextPageUrl = await page.$eval('.pagination a[rel="next"]', (el) => el.href);
            if (nextPageUrl) {
                await requestQueue.addRequest({ url: nextPageUrl });
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.warning(`Request ${request.url} failed. Retrying...`);
            await Apify.utils.sleep(1000);
            await requestQueue.addRequest(request);
        },
    });

    crawler.on('handleRequestFunction', async ({ request, response }) => {
        if (!response) {
            log.warning(`No response for ${request.url}`);
            return;
        }
        
        const { listing } = request.userData;
        const $ = await Apify.utils.enqueueLinks({
            $,
            requestQueue,
            selector: 'img',
            transformRequestFunction: (req) => ({
                ...req,
                userData: { listingImages: req.url },
                forefront: true,
            }),
        });

        listing.description = $('.listing-description').text().trim();
        listing.details = {
            bedrooms: $('.listing-bedrooms').text().trim(),
            bathrooms: $('.listing-bathrooms').text().trim(),
            squareFootage: $('.listing-sq-ft').text().trim(),
        };
        listing.agent = {
            name: $('.listing-agent-name').text().trim(),
            phone: $('.listing-agent-phone').text().trim(),
            email: $('.listing-agent-email').text().trim(),
        };
        listing.postedDate = $('.listing-posted-date').text().trim();
        listing.images = request.userData.listingImages || [];

        await Apify.pushData(listing);
    });

    log.info('Starting the crawl.');
    await crawler.run();
    log.info('Crawl finished.');
});