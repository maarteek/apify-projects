const Apify = require('apify');
const { log } = Apify.utils;

Apify.main(async () => {
    // Define the input schema
    const input = await Apify.getInput();
    const {
        searchQuery = '',
        maxListings = 50,
        includeDetails = true,
        proxy,
    } = input;

    // Create a RequestList
    const requestList = await Apify.openRequestList('start-urls', [
        `https://www.example.com/search?q=${encodeURIComponent(searchQuery)}`,
    ]);

    // Create a PuppeteerCrawler
    const crawler = new Apify.PuppeteerCrawler({
        requestList,
        maxRequestsPerCrawl: maxListings,
        launchContext: {
            useChrome: true,
            proxyUrl: proxy?.url,
        },
        handlePageFunction: async ({ page, request }) => {
            // Check if the current page is a search results page
            if (request.userData.label === 'LIST') {
                // Extract listing URLs from the search results page
                const listingUrls = await page.$$eval('.listing-item a', (links) =>
                    links.map((link) => link.href)
                );

                // Enqueue detail page URLs
                if (includeDetails) {
                    for (const url of listingUrls) {
                        await requestQueue.addRequest({
                            url,
                            userData: { label: 'DETAIL' },
                        });
                    }
                }
            }

            // Check if the current page is a detail page
            if (request.userData.label === 'DETAIL') {
                // Extract data from the listing detail page
                const data = await page.evaluate(() => {
                    const title = document.querySelector('.listing-title')?.textContent.trim();
                    const price = document.querySelector('.listing-price')?.textContent.trim();
                    const address = document.querySelector('.listing-address')?.textContent.trim();
                    const bedrooms = document.querySelector('.listing-bedrooms')?.textContent.trim();
                    const bathrooms = document.querySelector('.listing-bathrooms')?.textContent.trim();
                    const sqft = document.querySelector('.listing-sqft')?.textContent.trim();
                    const description = document.querySelector('.listing-description')?.textContent.trim();
                    const images = Array.from(document.querySelectorAll('.listing-images img')).map((img) =>
                        img.src
                    );
                    const agent = document.querySelector('.listing-agent')?.textContent.trim();
                    const postedDate = document.querySelector('.listing-posted-date')?.textContent.trim();

                    return {
                        title,
                        price,
                        location: {
                            address,
                        },
                        details: {
                            bedrooms,
                            bathrooms,
                            sqft,
                        },
                        description,
                        images,
                        agent,
                        url: window.location.href,
                        postedDate,
                    };
                });

                // Store the listing data
                await Apify.pushData(data);
            }

            // Find the next page button and enqueue the next page URL
            const nextButton = await page.$('.pagination-next');
            if (nextButton) {
                await requestQueue.addRequest({
                    url: await nextButton.evaluate((btn) => btn.href),
                    userData: { label: 'LIST' },
                });
            }
        },
        handleFailedRequestFunction: async ({ request, error }) => {
            log.error(`Request ${request.url} failed: ${error}`);
            await Apify.pushData({
                '#url': request.url,
                '#succeeded': false,
                '#error': error.message,
            });
        },
    });

    // Start the crawler
    await crawler.run();
});