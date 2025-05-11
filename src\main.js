// main.js
const Apify = require('apify');
const { log } = Apify.utils;

const INPUT_SCHEMA = {
    searchQuery: 'string',
    maxListings: 'number',
    includeDetails: 'boolean',
    proxy: 'object',
};

Apify.main(async () => {
    const input = await Apify.getInput();
    const {
        searchQuery,
        maxListings = 50,
        includeDetails = true,
        proxy,
    } = input ?? {};

    const requestQueue = await Apify.openRequestQueue();
    const dataset = await Apify.openDataset();

    // Initialize Puppeteer
    const browser = await Apify.launchPuppeteer({
        proxyUrl: proxy?.url,
    });
    const page = await browser.newPage();

    // Enqueue search results page
    await requestQueue.addRequest({
        url: `https://www.example.com/search?q=${encodeURIComponent(searchQuery)}`,
        userData: { label: 'SEARCH' },
    });

    // Set up crawler
    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        handlePageFunction: async ({ request, page }) => {
            const { label } = request.userData;

            if (label === 'SEARCH') {
                log.info(`Processing search results page: ${request.url}`);
                
                // Extract listing URLs from search results
                const listingUrls = await page.$$eval('.listing-item a', els => els.map(el => el.href));
                
                // Enqueue detail page URLs with limit
                for (const url of listingUrls.slice(0, maxListings)) {
                    await requestQueue.addRequest({
                        url,
                        userData: { label: 'DETAIL' },
                    });
                }

                // Check for next page and enqueue
                const nextPageUrl = await page.$eval('.pagination a.next', el => el.href);
                if (nextPageUrl) {
                    await requestQueue.addRequest({
                        url: nextPageUrl,
                        userData: { label: 'SEARCH' },
                    });
                }
            }

            if (label === 'DETAIL') {
                log.info(`Processing detail page: ${request.url}`);

                // Extract listing details
                const title = await page.$eval('.listing-title', el => el.textContent);
                const price = await page.$eval('.listing-price', el => el.textContent);
                const location = await page.$eval('.listing-location', el => el.textContent);
                const propertyDetails = await page.$$eval('.property-details li', els => els.map(el => el.textContent));
                const description = await page.$eval('.listing-description', el => el.textContent);
                const images = await page.$$eval('.listing-gallery img', els => els.map(el => el.src));
                const agent = await page.$eval('.listing-agent', el => el.textContent);
                const postedDate = await page.$eval('.listing-posted-date', el => el.textContent);

                // Save listing data
                await dataset.pushData({
                    title,
                    price,
                    location,
                    propertyDetails,
                    description,
                    images,
                    agent,
                    url: request.url,
                    postedDate, 
                });
            }
        },
        maxRequestRetries: 3,
        handleFailedRequestFunction: async ({ request }) => {
            log.warning(`Request failed after 3 retries: ${request.url}`);
        },
        proxyConfiguration: proxy,
        preNavigationHooks: [
            async ({ page }, gotoOptions) => {
                await Apify.utils.puppeteer.blockRequests(page);
            },
        ],
    });

    log.info('Starting the crawler...');
    await crawler.run();

    log.info('Crawler finished.');
    await browser.close();
});