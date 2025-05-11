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
    await requestQueue.addRequest({ url: `https://www.example.com/search?q=${encodeURIComponent(searchQuery)}` });

    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        proxyConfiguration: proxy,
        maxRequestsPerCrawl: maxListings,
        launchContext: {
            useChrome: true,
            stealth: true,
        },
        handlePageFunction: async ({ page, request }) => {
            // Function to extract listing details from the page
            const extractDetails = async () => {
                // Extract title, price, location, property details, description, images, agent info, and listing URL
                // Return the extracted data as an object
            };
            
            // Check if the current page is a search results page or a listing details page
            const isSearchPage = request.url.includes('/search');

            if (isSearchPage) {
                // Handle search results page
                const listings = await page.$$eval('.listing', (nodes) => {
                    return nodes.map((node) => ({
                        url: node.querySelector('a').href,
                        title: node.querySelector('h2').textContent.trim(),
                        price: node.querySelector('.price').textContent.trim(),
                        // Extract other relevant data from the search results
                    }));
                });

                // Enqueue listing detail pages for scraping
                if (includeDetails) {
                    for (const listing of listings) {
                        await requestQueue.addRequest({ url: listing.url, userData: listing });
                    }
                } else {
                    // If details are not needed, directly push listings to the dataset
                    await Apify.pushData(listings);
                }

                // Find and enqueue the next page URL for pagination
                const nextPageUrl = await page.$eval('.pagination a.next', (el) => el.href);
                if (nextPageUrl) {
                    await requestQueue.addRequest({ url: nextPageUrl });
                }
            } else {
                // Handle listing details page
                const listingData = await extractDetails();
                const { userData } = request;
                await Apify.pushData({ ...userData, ...listingData });
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.error(`Request ${request.url} failed too many times`);
            await Apify.pushData({
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },
    });

    log.info('Starting the crawl.');
    await crawler.run();
    log.info('Crawl finished.');
});