const Apify = require('apify');
const { puppet } = Apify.utils;

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
                log.info(`Navigating to search results page: ${request.url}`);
                await puppet.injectJQuery(page);

                // Click on consent dialog if present
                try {
                    await puppet.clickIfExists(page, '#consent-button');
                } catch (e) {
                    log.debug('Consent dialog not found');
                }

                // Extract listing URLs from search results
                const listingUrls = await page.evaluate(() => {
                    return $('.listing-item > a').map((_, el) => $(el).attr('href')).get();
                });

                // Enqueue listing URLs for scraping
                for (const url of listingUrls.slice(0, maxListings)) {
                    await requestQueue.addRequest({
                        url: new URL(url, request.url).href,
                        userData: { label: 'LISTING' },
                    }, { forefront: true });
                }

                // Enqueue next page URL if available and under maxListings limit
                const nextPageUrl = await page.$eval('.next-page', el => el.href);
                if (nextPageUrl && (await requestQueue.getInfo()).pendingRequestCount < maxListings) {
                    await requestQueue.addRequest({
                        url: new URL(nextPageUrl, request.url).href,
                        userData: { label: 'SEARCH' },
                    });
                }
            } else if (label === 'LISTING') {
                log.info(`Scraping listing details: ${request.url}`);
                await puppet.injectJQuery(page);

                // Extract listing details
                const listingData = await page.evaluate(() => {
                    const data = {};

                    data.title = $('h1.listing-title').text().trim();
                    data.price = $('span.listing-price').text().trim();
                    data.location = {
                        address: $('span.listing-address').text().trim(), 
                        city: $('span.listing-city').text().trim(),
                        postalCode: $('span.listing-postal').text().trim(),
                    };

                    const details = $('ul.listing-details > li').map((_, el) => $(el).text().trim()).get();
                    data.details = {
                        bedrooms: details.find(d => d.includes('bed'))?.match(/(\d+)/)?.[1],
                        bathrooms: details.find(d => d.includes('bath'))?.match(/(\d+)/)?.[1],
                        sqft: details.find(d => d.toLowerCase().includes('sqft'))?.match(/(\d+)/)?.[1],
                    };

                    data.description = $('p.listing-description').text().trim();
                    
                    data.images = $('img.listing-image').map((_, el) => $(el).attr('src')).get();

                    const agentEl = $('div.listing-agent');
                    data.agent = {
                        name: agentEl.find('h3').text().trim(),
                        phone: agentEl.find('span.phone').text().trim(),
                        email: agentEl.find('span.email').text().trim(),
                    };

                    data.url = window.location.href;
                    data.postedDate = $('span.listing-posted-date').text().trim();

                    return data;
                });

                await Apify.pushData(listingData);
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.warning(`Request failed after ${request.retryCount} retries`, { url: request.url });
            await Apify.pushData({
                '#isFailed': true,
                '#failedRequestUrl': request.url,
                '#failedRequestDetails': request,
            });
        },
    });

    log.info('Starting the crawl...');
    await crawler.run();
    log.info('Crawl finished!');
});