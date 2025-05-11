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
        },
        handlePageFunction: async ({ request, page }) => {
            const { label } = request.userData;

            if (label === 'SEARCH') {
                log.info('Scraping search results');
                const listings = await page.$$eval('.listing-item', (nodes) =>
                    nodes.map((node) => ({
                        url: node.querySelector('a').href,
                        title: node.querySelector('.listing-title').textContent.trim(),
                        price: node.querySelector('.listing-price').textContent.trim(),
                        location: node.querySelector('.listing-location').textContent.trim(),
                    }))
                );

                for (const listing of listings) {
                    if (await requestQueue.getInfo().requestsCount >= maxListings) break;
                    await requestQueue.addRequest({
                        url: listing.url,
                        userData: { label: 'LISTING', ...listing },
                    });
                }

                const nextPageUrl = await page.$eval('.pagination a.next', (el) => el.href);
                if (nextPageUrl && (await requestQueue.getInfo().requestsCount < maxListings)) {
                    await requestQueue.addRequest({
                        url: nextPageUrl,
                        userData: { label: 'SEARCH' },
                    });
                }
            } else if (label === 'LISTING' && includeDetails) {
                log.info(`Scraping listing details: ${request.url}`);
                const { title, price, location } = request.userData;
                const details = await page.evaluate(() => ({
                    bedrooms: document.querySelector('.listing-bedrooms')?.textContent.trim(),
                    bathrooms: document.querySelector('.listing-bathrooms')?.textContent.trim(),
                    size: document.querySelector('.listing-size')?.textContent.trim(),
                    description: document.querySelector('.listing-description')?.textContent.trim(),
                    images: Array.from(document.querySelectorAll('.listing-images img')).map((img) => img.src),
                    agent: {
                        name: document.querySelector('.listing-agent-name')?.textContent.trim(),
                        phone: document.querySelector('.listing-agent-phone')?.textContent.trim(),
                        email: document.querySelector('.listing-agent-email')?.textContent.trim(),
                    },
                    postedDate: document.querySelector('.listing-posted-date')?.textContent.trim(),
                }));

                await Apify.pushData({
                    url: request.url,
                    title,
                    price,
                    location,
                    ...details,
                });
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.warning(`Request failed: ${request.url}. Retrying...`);
            await Apify.utils.sleep(1000); // Wait a second before retrying
            await requestQueue.addRequest(request);
        },
    });

    log.info('Starting the crawl...');
    await crawler.run();
    log.info('Crawl finished.');
});