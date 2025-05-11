// main.js
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
        userData: { label: 'SEARCH' },
    });

    const proxyConfiguration = await Apify.createProxyConfiguration(proxy);

    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        proxyConfiguration,
        useSessionPool: true,
        persistCookiesPerSession: true,
        maxRequestRetries: 3,
        handlePageFunction: async ({ request, page }) => {
            const label = request.userData.label;

            if (label === 'SEARCH') {
                // Handle search results page
                log.info(`Processing search results for query: ${searchQuery}`);

                const listings = await page.$$eval('.listing-card', (nodes) =>
                    nodes.map((node) => ({
                        url: node.querySelector('a').href,
                        title: node.querySelector('h3').textContent.trim(),
                        price: node.querySelector('.listing-price').textContent.trim(),
                        location: node.querySelector('.listing-location').textContent.trim(),
                    }))
                );

                for (const listing of listings) {
                    if (includeDetails) {
                        await requestQueue.addRequest({
                            url: listing.url,
                            userData: { label: 'DETAIL', listing },
                        }, { forefront: true });
                    } else {
                        await Apify.pushData(listing);
                    }
                }

                // Pagination
                if (await page.$('.next-page')) {
                    await requestQueue.addRequest({
                        url: await page.$eval('.next-page', (el) => el.href),
                        userData: { label: 'SEARCH' },
                    });
                }
            } else if (label === 'DETAIL') {
                // Handle detail page
                log.info(`Processing detail page for listing: ${request.userData.listing.title}`);

                const { listing } = request.userData;

                listing.description = await page.$eval('.listing-description', (el) => el.textContent.trim());
                listing.details = await page.$eval('.listing-details', (el) => el.textContent.trim());
                listing.images = await page.$$eval('.listing-images img', (nodes) => nodes.map((img) => img.src));
                listing.agent = await page.$eval('.listing-agent', (el) => el.textContent.trim());
                listing.datePosted = await page.$eval('.listing-date', (el) => el.textContent.trim());

                await Apify.pushData(listing);
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.error(`Request ${request.url} failed too many times`);
        },
    });

    log.info('Starting the crawl...');
    await crawler.run();
    log.info('Crawl finished.');
});