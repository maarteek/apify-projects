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
        url: `https://www.propertywebsite.com/search?q=${encodeURIComponent(searchQuery)}`,
        userData: { label: 'SEARCH' },
    });

    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        proxyConfiguration: proxy,
        launchContext: {
            useChrome: true,
            launchOptions: {
                headless: true,
            },
        },
        handlePageFunction: async ({ request, page }) => {
            const label = request.userData.label;

            if (label === 'SEARCH') {
                log.info('Scraping search results...');
                const listings = await page.$$eval('.listing-item', (nodes) => {
                    return nodes.map((node) => ({
                        url: node.querySelector('a').href,
                        title: node.querySelector('h3').textContent.trim(),
                        price: node.querySelector('.price').textContent.trim(),
                        location: node.querySelector('.location').textContent.trim(),
                    }));
                });

                for (const listing of listings) {
                    if (await requestQueue.getCount() >= maxListings) {
                        break;
                    }
                    await requestQueue.addRequest({
                        url: listing.url,
                        userData: { label: 'DETAIL', ...listing },
                    });
                }

                // Handle pagination
                const nextButton = await page.$('.next-page');
                if (nextButton && (await requestQueue.getCount()) < maxListings) {
                    await nextButton.click();
                    await page.waitForSelector('.listing-item');
                    await Apify.utils.enqueueLinks({
                        page,
                        requestQueue,
                        selector: '.next-page',
                        transformRequestFunction: (req) => ({
                            ...req,
                            userData: { label: 'SEARCH' },
                        }),
                    });
                }
            } else if (label === 'DETAIL' && includeDetails) {
                log.info(`Scraping details for ${request.userData.url}`);
                const { url, title, price, location } = request.userData;

                const details = await page.evaluate(() => {
                    const description = document.querySelector('.description').textContent.trim();
                    const images = Array.from(document.querySelectorAll('.gallery img')).map((img) => img.src);
                    const agent = document.querySelector('.agent-info').textContent.trim();
                    const datePosted = document.querySelector('.date-posted').textContent.trim();
                    const bedrooms = document.querySelector('.bedrooms').textContent.trim();
                    const bathrooms = document.querySelector('.bathrooms').textContent.trim();
                    const squareFootage = document.querySelector('.sq-footage').textContent.trim();

                    return {
                        description,
                        images,
                        agent,
                        datePosted,
                        bedrooms,
                        bathrooms,
                        squareFootage,
                    };
                });

                await Apify.pushData({
                    url,
                    title,
                    price,
                    location,
                    ...details,
                });
            }
        },

        handleFailedRequestFunction: async ({ request }) => {
            log.warning(`Request ${request.url} failed. Retrying...`);
            await Apify.utils.sleep(1000);
            return request;
        },
    });

    log.info('Starting the crawl...');
    await crawler.run();
    log.info('Crawl finished.');
});