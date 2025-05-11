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
        launchContext: {
            useChrome: true,
            stealth: true,
            launchOptions: {
                headless: true,
            },
        },
        handlePageFunction: async ({ request, page }) => {
            const label = request.userData.label;

            if (label === 'SEARCH') {
                log.info(`Searching for "${searchQuery}"`);
                await page.waitForSelector('.listing-item');

                const listings = await page.$$eval('.listing-item', (nodes) => {
                    return nodes.map((node) => ({
                        url: node.querySelector('a').href,
                        title: node.querySelector('h3').textContent.trim(),
                        price: node.querySelector('.price').textContent.trim(),
                        location: node.querySelector('.location').textContent.trim(),
                    }));
                });

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

                const nextButtonDisabled = await page.$eval('.next-button', (el) => el.disabled);
                if (maxListings > listings.length && !nextButtonDisabled) {
                    await requestQueue.addRequest({
                        url: await page.$eval('.next-button', (el) => el.href),
                        userData: { label: 'SEARCH' },
                    });
                }
            } else if (label === 'DETAIL') {
                log.info(`Scraping details for "${request.userData.listing.title}"`);
                await page.waitForSelector('.listing-details');

                const details = await page.evaluate(() => {
                    const propertyDetails = {};
                    const detailNodes = document.querySelectorAll('.listing-details li');
                    detailNodes.forEach((node) => {
                        const [key, value] = node.textContent.trim().split(':');
                        propertyDetails[key.trim()] = value.trim();
                    });

                    return {
                        description: document.querySelector('.description').textContent.trim(),
                        images: Array.from(document.querySelectorAll('.gallery img')).map((img) => img.src),
                        agent: document.querySelector('.agent-name').textContent.trim(),
                        contactInfo: document.querySelector('.agent-contact').textContent.trim(),
                        datePosted: document.querySelector('.date-posted').textContent.trim(),
                        propertyDetails,
                    };
                });

                await Apify.pushData({ ...request.userData.listing, ...details });
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.warning(`Request ${request.url} failed, retrying...`);
            await Apify.utils.sleep(1000);
            await requestQueue.addRequest(request);
        },
    });

    log.info('Starting the crawler.');
    await crawler.run();

    log.info('Crawler finished.');
});