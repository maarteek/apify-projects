const Apify = require('apify');
const { URL } = require('url');

const { utils: { log } } = Apify;

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
            launchOptions: {
                headless: true,
            },
        },
        handlePageFunction: async ({ request, page }) => {
            const label = request.userData.label;

            if (label === 'SEARCH') {
                log.info(`Processing search results page: ${request.url}`);

                // Scrape listing URLs from the search results page
                const listingUrls = await page.$$eval('.listing-item > a', (links) =>
                    links.map((link) => link.href)
                );

                // Enqueue listing URLs for further processing
                for (const url of listingUrls) {
                    await requestQueue.addRequest({
                        url,
                        userData: { label: 'LISTING' },
                    });
                }

                // Check if there are more search result pages
                const nextPageUrl = await page.$eval('.pagination a.next', (el) => el.href);
                if (nextPageUrl) {
                    await requestQueue.addRequest({
                        url: new URL(nextPageUrl, request.url).href,
                        userData: { label: 'SEARCH' },
                    });
                }
            } else if (label === 'LISTING') {
                log.info(`Processing listing page: ${request.url}`);

                // Scrape listing details
                const listing = await page.evaluate(() => {
                    const titleEl = document.querySelector('h1');
                    const priceEl = document.querySelector('.price');
                    const addressEl = document.querySelector('.address');
                    const detailsEl = document.querySelector('.property-details');
                    const descriptionEl = document.querySelector('.description');
                    const imageEls = document.querySelectorAll('.gallery img');
                    const agentEl = document.querySelector('.agent-info');

                    return {
                        title: titleEl ? titleEl.innerText.trim() : null,
                        price: priceEl ? priceEl.innerText.trim() : null,
                        location: addressEl ? addressEl.innerText.trim() : null,
                        details: detailsEl ? detailsEl.innerText.trim() : null,
                        description: descriptionEl ? descriptionEl.innerText.trim() : null,
                        images: Array.from(imageEls).map((img) => img.src),
                        agent: agentEl ? agentEl.innerText.trim() : null,
                        url: request.url,
                        postedDate: null,
                    };
                });

                // Extract property details
                if (listing.details) {
                    const detailsRegex = /(\d+)\s+bed.*?(\d+)\s+bath.*?(\d+)\s+sqft/i;
                    const match = listing.details.match(detailsRegex);
                    if (match) {
                        listing.bedrooms = parseInt(match[1], 10);
                        listing.bathrooms = parseInt(match[2], 10);
                        listing.squareFootage = parseInt(match[3], 10);
                    }
                }

                // Extract location details
                if (listing.location) {
                    const addressParts = listing.location.split(',').map((part) => part.trim());
                    listing.address = addressParts[0] || null;
                    listing.city = addressParts[1] || null;
                    listing.postalCode = addressParts[2] || null;
                    delete listing.location;
                }

                // Cleanup agent info
                if (listing.agent) {
                    listing.agent = listing.agent.replace(/\s+/g, ' ');
                }

                // Extract date posted if available
                const datePostedEl = await page.$('.date-posted');
                if (datePostedEl) {
                    listing.postedDate = await page.evaluate(
                        (el) => el.innerText.trim(),
                        datePostedEl
                    );
                }

                await Apify.pushData(listing);
            }
        },
        maxRequestsPerCrawl: maxListings,
    });

    await crawler.run();
    log.info('Scraping finished.');
});