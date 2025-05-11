const Apify = require('apify');
const { RequestQueue, Dataset } = Apify.default;

Apify.main(async () => {
    // Define input schema
    const input = await Apify.getInput({
        schema: {
            searchQuery: {
                type: 'string',
                description: 'Text to search for (e.g., "apartments in London")',
                default: 'apartments in London',
            },
            maxListings: {
                type: 'integer',
                description: 'Maximum number of listings to scrape',
                default: 50,
            },
            includeDetails: {
                type: 'boolean',
                description: 'Determine if detailed page info should be scraped',
                default: true,
            },
            proxy: {
                type: 'object',
                description: 'Proxy configuration object',
            },
        },
    });

    const { searchQuery, maxListings, includeDetails, proxy } = input;

    // Initialize request queue and dataset
    const requestQueue = await RequestQueue.open();
    const dataset = await Dataset.open();

    // Add search page URL to the request queue
    await requestQueue.addRequest({
        url: `https://www.propertywebsite.com/search?q=${encodeURIComponent(searchQuery)}`,
        userData: { label: 'SEARCH' },
    });

    // Create a crawler
    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        proxyConfiguration: proxy,
        launchContext: {
            useChrome: true,
            stealth: true,
            launchOptions: {
                headless: true,
            },
        },
        handlePageFunction: async ({ page, request }) => {
            const label = request.userData.label;

            // Extract data from the listing page
            if (label === 'LISTING') {
                const data = await extractListingData(page);
                await dataset.pushData(data);
                return;
            }

            // Extract data from the search results page
            const listings = await page.$$('.listing-item');

            for (const [index, listing] of listings.entries()) {
                if (index >= maxListings) break;

                const url = await listing.$eval('a', (el) => el.href);

                if (includeDetails) {
                    await requestQueue.addRequest({
                        url,
                        userData: { label: 'LISTING' },
                    });
                } else {
                    const data = await extractListingSummary(listing);
                    data.url = url;
                    await dataset.pushData(data);
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
        },

        handleFailedRequestFunction: async ({ request }) => {
            Apify.utils.log.error(`Request ${request.url} failed too many times`, request);
        },
    });

    // Start the crawler
    await crawler.run();

    Apify.utils.log.info('Scraping finished.');
});

async function extractListingData(page) {
    // Extract detailed listing data from the listing page
    const data = {};

    data.title = await page.$eval('h1', (el) => el.textContent.trim());
    data.price = await page.$eval('.price', (el) => el.textContent.trim());
    data.location = await page.$eval('.location', (el) => el.textContent.trim());
    data.details = await page.$eval('.details', (el) => el.textContent.trim());
    data.description = await page.$eval('.description', (el) => el.textContent.trim());
    data.images = await page.$$eval('img', (els) => els.map((el) => el.src));
    data.agent = await page.$eval('.agent', (el) => el.textContent.trim());
    data.url = page.url();
    data.postedDate = await page.$eval('.posted-date', (el) => el.textContent.trim());

    return data;
}

async function extractListingSummary(listing) {
    // Extract summary data from the listing element on the search results page
    const data = {};

    data.title = await listing.$eval('.title', (el) => el.textContent.trim());
    data.price = await listing.$eval('.price', (el) => el.textContent.trim());
    data.location = await listing.$eval('.location', (el) => el.textContent.trim());

    return data;
}