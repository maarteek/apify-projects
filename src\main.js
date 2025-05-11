const Apify = require('apify');
const { puppeteer } = require('puppeteer-extra');
const proxyChain = require('proxy-chain');
const { log } = Apify.utils;

const { utils: { log } } = Apify;

Apify.main(async () => {
    const input = await Apify.getInput();
    const {
        searchQuery = '',
        maxListings = 50,
        includeDetails = true,
        proxy = { useApifyProxy: true },
    } = input;

    const proxyConfiguration = await proxyChain.resolveProxyConfiguration(proxy);

    // Initialize Puppeteer browser with proxy
    const browser = await puppeteer.launch({
        args: [...proxyChain.createProxyArgs(proxyConfiguration)],
    });

    const requestQueue = await Apify.openRequestQueue();
    await requestQueue.addRequest({
        url: `https://www.example.com/search?q=${encodeURIComponent(searchQuery)}`,
        userData: { label: 'SEARCH' },
    });

    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        proxyConfiguration,
        launchContext: {
            useChrome: true,
            stealth: true,
        },
        handlePageFunction: async ({ request, page }) => {
            const label = request.userData.label;

            if (label === 'SEARCH') {
                log.info('Searching for listings...');
                const listingUrls = await page.$$eval('.listing-link', (links) => 
                    links.map((link) => link.href).slice(0, maxListings)
                );

                for (const url of listingUrls) {
                    await requestQueue.addRequest({
                        url,
                        userData: { label: 'LISTING' },
                    }, { forefront: true });
                }

                // Check for next page
                const nextPageUrl = await page.$eval('.pagination-next', (el) => el.href);
                if (nextPageUrl) {
                    await requestQueue.addRequest({
                        url: nextPageUrl,
                        userData: { label: 'SEARCH' },
                    });
                }
            }

            if (label === 'LISTING') {
                const listing = await page.evaluate(() => {
                    const titleEl = document.querySelector('h1');
                    const priceEl = document.querySelector('.price');
                    const addressEl = document.querySelector('.address');
                    const detailsEl = document.querySelector('.details');
                    const descriptionEl = document.querySelector('.description');
                    const imageEls = document.querySelectorAll('.gallery img');
                    const agentEl = document.querySelector('.agent-info');
                    const dateEl = document.querySelector('.listing-date');

                    return {
                        title: titleEl && titleEl.textContent.trim(),
                        price: priceEl && priceEl.textContent.trim(),
                        location: addressEl && addressEl.textContent.trim(),
                        details: detailsEl && detailsEl.textContent.trim(),
                        description: descriptionEl && descriptionEl.textContent.trim(),
                        images: [...imageEls].map((img) => img.src),
                        agent: agentEl && agentEl.textContent.trim(),
                        url: window.location.href,
                        datePosted: dateEl && dateEl.textContent.trim(),
                    };
                });

                log.info(`Scraped listing: ${listing.title}`);
                await Apify.pushData(listing);
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            log.error(`Request ${request.url} failed too many times`);
        },
    });

    log.info('Starting the crawl...');
    await crawler.run();
    log.info('Crawl finished.');
    await browser.close();
});