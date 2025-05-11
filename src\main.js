const Apify = require('apify');
const {
    utils: { log },
} = Apify;

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
        url: `https://www.example.com/search?q=${encodeURIComponent(searchQuery)}`,
        userData: { label: 'START' },
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
        handlePageFunction: async ({ request, page }) => {
            const label = request.userData.label;

            if (label === 'START') {
                log.info('Searching for listings...');
                const listings = await page.$$eval('.listing-item', (items) =>
                    items.map((item) => ({
                        url: item.querySelector('a').href,
                        title: item.querySelector('.listing-title').textContent.trim(),
                        price: item.querySelector('.listing-price').textContent.trim(),
                        location: item.querySelector('.listing-location').textContent.trim(),
                    }))
                );

                for (const listing of listings.slice(0, maxListings)) {
                    if (includeDetails) {
                        await requestQueue.addRequest({
                            url: listing.url,
                            userData: { label: 'DETAIL', listing },
                        });
                    } else {
                        await Apify.pushData(listing);
                    }
                }

                // Navigate to the next page
                const nextButton = await page.$('.next-page');
                if (nextButton) {
                    await nextButton.click();
                    await page.waitForNavigation();
                    await requestQueue.addRequest({
                        url: page.url(),
                        userData: { label: 'START' },
                    });
                }
            } else if (label === 'DETAIL') {
                log.info(`Scraping details for listing: ${request.userData.listing.url}`);
                const { listing } = request.userData;

                listing.description = await page.$eval('.listing-description', (el) => el.textContent.trim());
                listing.details = await page.$eval('.listing-details', (el) => el.textContent.trim());
                listing.images = await page.$$eval('.listing-image', (imgs) => imgs.map((img) => img.src));
                listing.agent = await page.$eval('.listing-agent', (el) => el.textContent.trim());
                listing.postedDate = await page.$eval('.listing-posted-date', (el) => el.textContent.trim());

                await Apify.pushData(listing);
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.warning(`Request ${request.url} failed. Retrying...`);
            await Apify.utils.sleep(1000);
            await requestQueue.addRequest(request);
        },
    });

    log.info('Starting the crawl...');
    await crawler.run();
    log.info('Crawl finished.');
});