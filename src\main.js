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
        handlePageFunction: async ({ page, request }) => {
            // Wait for search results to load
            await page.waitForSelector('.search-results');

            // Extract listing URLs from search results
            const listingUrls = await page.$$eval('.listing-item a', (links) =>
                links.map((link) => link.href)
            );

            // Enqueue listing pages for detail scraping
            if (includeDetails) {
                for (const url of listingUrls) {
                    await requestQueue.addRequest({ url, userData: { label: 'DETAIL' } });
                }
            }

            // Extract listing data from search results page
            const listings = await extractListings(page);
            log.info(`Extracted ${listings.length} listings from ${request.url}`);

            // Check if there are more pages and enqueue next page URL
            const nextPageUrl = await getNextPageUrl(page);
            if (nextPageUrl && listings.length < maxListings) {
                await requestQueue.addRequest({ url: nextPageUrl });
            }

            // Push listings to dataset
            await Apify.pushData(listings);
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.warning(`Request ${request.url} failed. Retrying...`);
            await Apify.utils.sleep(1000);
            await requestQueue.addRequest(request);
        },
    });

    // Set up separate handler for listing detail pages
    crawler.on('handleRequestFunction', async ({ request, page }) => {
        if (request.userData.label === 'DETAIL') {
            const listingData = await extractListingDetails(page);
            log.info(`Extracted details for ${request.url}`);
            await Apify.pushData(listingData);
        }
    });

    await crawler.run();

    async function extractListings(page) {
        // Extract listing data from search results page
        // Implement logic to extract title, price, location, etc.
        // Return an array of listing objects
    }

    async function extractListingDetails(page) {
        // Extract detailed data from individual listing page
        // Implement logic to extract description, images, agent info, etc.
        // Return a listing object with detailed information
    }

    async function getNextPageUrl(page) {
        // Check if there is a next page URL
        // Return the URL if found, otherwise return null
    }
});