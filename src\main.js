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
    const requestList = await Apify.openRequestList('start-urls', [
        `https://www.example.com/search?query=${encodeURIComponent(searchQuery)}`,
    ]);

    const proxyConfiguration = await Apify.createProxyConfiguration(proxy);

    const crawler = new Apify.PuppeteerCrawler({
        requestList,
        requestQueue,
        proxyConfiguration,
        launchContext: {
            useChrome: true,
            stealth: true,
        },
        handlePageFunction: async ({ request, page }) => {
            const listings = await page.$$eval('.listing', (nodes) => {
                return nodes.map((node) => ({
                    url: node.querySelector('a').href,
                    title: node.querySelector('h2').textContent.trim(),
                    price: node.querySelector('.price').textContent.trim(),
                    location: node.querySelector('.location').textContent.trim(),
                }));
            });

            if (includeDetails) {
                for (const listing of listings) {
                    await requestQueue.addRequest({
                        url: listing.url,
                        userData: listing,
                    });
                }
            } else {
                await Apify.pushData(listings);
            }

            if (await page.$('.next-page')) {
                await requestQueue.addRequest({
                    url: await page.$eval('.next-page', (el) => el.href),
                    userData: { label: 'PAGINATION' },
                });
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.warning(`Request ${request.url} failed. Retrying...`);
            await Apify.utils.sleep(1000);
            return request;
        },
        maxRequestRetries: 3,
        maxRequestsPerCrawl: maxListings,
    });

    crawler.on('handleRequestFunction', async ({ request, page }) => {
        if (!request.userData.label) {
            log.info(`Scraping listing detail page: ${request.url}`);

            const listingData = await page.evaluate(() => {
                const details = {};
                details.bedrooms = document.querySelector('.bedrooms').textContent.trim();
                details.bathrooms = document.querySelector('.bathrooms').textContent.trim();
                details.sqft = document.querySelector('.sqft').textContent.trim();
                details.description = document.querySelector('.description').textContent.trim();
                details.images = [...document.querySelectorAll('.images img')].map((img) => img.src);
                details.agent = document.querySelector('.agent-info').textContent.trim();
                details.postedDate = document.querySelector('.posted-date').textContent.trim();
                return details;
            });

            await Apify.pushData({ ...request.userData, ...listingData });
        }
    });

    log.info('Starting the crawl...');
    await crawler.run();
    log.info('Crawl finished.');
});