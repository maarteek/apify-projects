const Apify = require('apify');
const { puppeteer } = require('puppeteer-extra');
const { DEFAULT_PROXY_GROUP_NAME } = require('apify/consts');

Apify.main(async () => {
    const input = await Apify.getInput();
    const {
        searchQuery = 'apartments in London',
        maxListings = 50,
        includeDetails = true,
        proxy = { useApifyProxy: true },
    } = input;

    // Set up proxy configuration
    const proxyConfiguration = await Apify.createProxyConfiguration({
        groups: [
            {
                useApifyProxy: proxy.useApifyProxy,
                apifyProxyGroups: [DEFAULT_PROXY_GROUP_NAME],
            },
        ],
    });

    // Create a RequestQueue to store URLs to crawl
    const requestQueue = await Apify.openRequestQueue();
    await requestQueue.addRequest({ url: `https://www.example.com/search?q=${encodeURIComponent(searchQuery)}` });

    // Create a dataset to store the scraped results
    const dataset = await Apify.openDataset();

    // Crawler configuration
    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        proxyConfiguration,
        launchContext: {
            useIncognitoPages: true,
            stealth: true,
        },
        handlePageFunction: async ({ page, request }) => {
            await Apify.utils.puppeteer.injectJQuery(page);

            if (request.userData.label === 'LISTING') {
                // Extract details from the listing page
                const data = await page.evaluate(() => {
                    const title = $('h1').text().trim();
                    const price = $('.price').text().trim();
                    const location = $('.location').text().trim();
                    const bedrooms = $('.bedrooms').text().trim();
                    const bathrooms = $('.bathrooms').text().trim();
                    const squareFootage = $('.square-footage').text().trim();
                    const description = $('.description').text().trim();
                    const images = $('.gallery img').map((_, img) => $(img).attr('src')).get();
                    const agentInfo = {
                        name: $('.agent-name').text().trim(),
                        phone: $('.agent-phone').text().trim(),
                        email: $('.agent-email').text().trim(),
                    };
                    const datePosted = $('.date-posted').text().trim();

                    return {
                        title,
                        price,
                        location,
                        bedrooms,
                        bathrooms,
                        squareFootage,
                        description,
                        images,
                        agentInfo,
                        url: request.url,
                        datePosted,
                    };
                });

                // Store the listing data
                await dataset.pushData(data);
            } else {
                // Extract listing URLs from the search results page
                const listingUrls = await page.$$eval('.listing-item a', (links) =>
                    links.map((link) => link.href)
                );

                // Enqueue listing URLs for further crawling
                for (const url of listingUrls) {
                    await requestQueue.addRequest({
                        url,
                        userData: { label: 'LISTING' },
                    });
                }

                // Check for pagination and enqueue next page URL
                const nextPageUrl = await page.$eval('.pagination a.next', (link) => link.href);
                if (nextPageUrl) {
                    await requestQueue.addRequest({ url: nextPageUrl });
                }
            }
        },
        maxRequestsPerCrawl: maxListings,
    });

    // Run the crawler
    await crawler.run();

    console.log('Scraping completed.');
});