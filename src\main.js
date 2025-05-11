const Apify = require('apify');
const { log } = Apify.utils;

Apify.main(async () => {
    const input = await Apify.getInput();
    const {
        searchQuery = '',
        maxListings = 50,
        includeDetails = true,
        proxy,
    } = input;

    const requestQueue = await Apify.openRequestQueue();
    await requestQueue.addRequest({
        url: `https://www.propertywebsite.com/search?q=${encodeURIComponent(searchQuery)}`,
        userData: { label: 'SEARCH' },
    });

    const proxyConfiguration = await Apify.createProxyConfiguration(proxy);

    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        proxyConfiguration,
        launchContext: {
            useChrome: true,
            launchOptions: {
                headless: true,
            },
        },
        maxRequestsPerCrawl: maxListings,
        handlePageFunction: async ({ request, page }) => {
            const { label } = request.userData;

            if (label === 'SEARCH') {
                log.info(`Processing search results page: ${request.url}`);
                const listings = await page.$$eval('.listing-item', (nodes) =>
                    nodes.map((node) => ({
                        url: node.querySelector('a').href,
                        title: node.querySelector('h3').textContent.trim(),
                        price: node.querySelector('.price').textContent.trim(),
                        location: node.querySelector('.location').textContent.trim(),
                    }))
                );

                for (const listing of listings) {
                    if (includeDetails) {
                        await requestQueue.addRequest({
                            url: listing.url,
                            userData: { label: 'DETAIL', listing },
                        });
                    } else {
                        await Apify.pushData(listing);
                    }
                }

                // Handle pagination
                const nextPageUrl = await page.$eval('.next-page', (el) => el.href);
                if (nextPageUrl) {
                    await requestQueue.addRequest({
                        url: nextPageUrl,
                        userData: { label: 'SEARCH' },
                    });
                }
            } else if (label === 'DETAIL') {
                log.info(`Processing listing detail page: ${request.url}`);
                const { listing } = request.userData;

                listing.details = await page.$eval('.property-details', (el) => el.textContent.trim());
                listing.description = await page.$eval('.description', (el) => el.textContent.trim());
                listing.images = await page.$$eval('.gallery img', (nodes) => nodes.map((node) => node.src));
                listing.agent = await page.$eval('.agent-info', (el) => el.textContent.trim());
                listing.datePosted = await page.$eval('.date-posted', (el) => el.textContent.trim());

                await Apify.pushData(listing);
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.warning(`Request failed: ${request.url}`);
            await Apify.utils.sleep(5000); // Delay before retrying
            await requestQueue.addRequest(request); // Retry the failed request
        },
    });

    log.info('Starting the crawl...');
    await crawler.run();
    log.info('Crawl finished.');
});