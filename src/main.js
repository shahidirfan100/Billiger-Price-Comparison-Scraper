// Billiger.de Price Comparison Scraper - Fast & Stealthy CheerioCrawler
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            searchQuery = '',
            startUrl,
            startUrls,
            url,
            results_wanted: RESULTS_WANTED_RAW = 20,
            collectOffers = true,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 20;

        const toAbs = (href, base = 'https://www.billiger.de') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const buildSearchUrl = (query) => {
            if (!query) return null;
            const u = new URL('https://www.billiger.de/search');
            u.searchParams.set('searchstring', String(query).trim());
            return u.href;
        };

        const cleanPrice = (priceStr) => {
            if (!priceStr && priceStr !== 0) return null;
            const str = String(priceStr).replace(/\s/g, '').replace(/[€EUR]/gi, '');
            const match = str.match(/(\d+[.,]?\d*)/);
            if (match) {
                return parseFloat(match[1].replace(',', '.'));
            }
            return null;
        };

        const cleanImageUrl = (imgData) => {
            if (!imgData) return null;
            // Handle ImageObject format
            if (typeof imgData === 'object') {
                if (Array.isArray(imgData)) {
                    const first = imgData[0];
                    if (typeof first === 'string') return first;
                    return first?.contentUrl || first?.url || first?.thumbnailUrl || null;
                }
                return imgData.contentUrl || imgData.url || imgData.thumbnailUrl || null;
            }
            return String(imgData);
        };

        const cleanShopName = (name) => {
            if (!name) return null;
            return name
                .replace(/^Infos zu\s*/i, '')
                .replace(/Shop-Informationen\s*/i, '')
                .replace(/für\s*/i, '')
                .trim();
        };

        // Extract JSON-LD data from page
        function extractJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            const results = [];
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    results.push(...arr);
                } catch { /* ignore parsing errors */ }
            }
            return results;
        }

        // Extract product data from JSON-LD
        function extractProductFromJsonLd(jsonLdArray) {
            for (const item of jsonLdArray) {
                if (!item) continue;
                const type = item['@type'];
                if (type === 'Product' || type === 'ProductGroup') {
                    const offers = item.offers || {};
                    const aggregateRating = item.aggregateRating || {};

                    // Handle AggregateOffer type
                    let lowPrice = null, highPrice = null, offerCount = null;

                    if (offers['@type'] === 'AggregateOffer') {
                        lowPrice = cleanPrice(offers.lowPrice);
                        highPrice = cleanPrice(offers.highPrice);
                        offerCount = parseInt(offers.offerCount, 10) || null;
                    } else if (offers.price) {
                        lowPrice = cleanPrice(offers.price);
                    }

                    return {
                        product_name: item.name || null,
                        brand: item.brand?.name || (typeof item.brand === 'string' ? item.brand : null),
                        gtin: item.gtin13 || item.gtin || null,
                        sku: item.sku || null,
                        lowest_price: lowPrice,
                        highest_price: highPrice,
                        offer_count: offerCount,
                        rating: parseFloat(aggregateRating.ratingValue) || null,
                        review_count: parseInt(aggregateRating.reviewCount, 10) || null,
                        image_url: cleanImageUrl(item.image),
                        currency: offers.priceCurrency || 'EUR',
                        description: item.description || null,
                    };
                }
            }
            return null;
        }

        // Extract individual offers from HTML
        function extractOffersFromHtml($, baseUrl) {
            const offers = [];

            // Find all offer containers - look for elements with price and shop info
            $('div[class*="offer"], [data-offer-row], [class*="price-row"]').each((_, el) => {
                const $el = $(el);
                const text = $el.text();

                // Skip if no price-like content
                if (!text.match(/\d+[.,]\d{2}/)) return;

                // Extract shop name from various sources
                let shopName = null;
                const shopBtn = $el.find('button[title*="Shop"]');
                if (shopBtn.length) {
                    shopName = shopBtn.attr('aria-label') || shopBtn.attr('title') || '';
                }
                if (!shopName) {
                    const shopImg = $el.find('img[alt]').first();
                    shopName = shopImg.attr('alt') || '';
                }
                if (!shopName) {
                    const shopLink = $el.find('a[title]').first();
                    shopName = shopLink.attr('title') || '';
                }

                shopName = cleanShopName(shopName);
                if (!shopName) return;

                // Extract price - first number in the row
                const priceMatch = text.match(/(\d+[.,]\d{2})\s*€/);
                const price = priceMatch ? cleanPrice(priceMatch[1]) : null;
                if (!price) return;

                // Extract shipping
                const shippingMatch = text.match(/(?:ab|zzgl\.)\s*(\d+[.,]\d{2})\s*€\s*Versand/i);
                const shipping = shippingMatch ? cleanPrice(shippingMatch[1]) : 0;

                // Extract total price if available
                const totalMatch = text.match(/(\d+[.,]\d{2})\s*€\s*Gesamt/i);
                const total = totalMatch ? cleanPrice(totalMatch[1]) : (price + (shipping || 0));

                // Extract offer link - look for redirect links
                let offerUrl = null;
                const redirectLink = $el.find('a[href*="/redirect"]').attr('href');
                if (redirectLink) {
                    offerUrl = toAbs(redirectLink, baseUrl);
                } else {
                    const anyLink = $el.find('a[href^="http"]').attr('href');
                    if (anyLink) offerUrl = anyLink;
                }

                offers.push({
                    shop_name: shopName,
                    price,
                    shipping_cost: shipping,
                    total_price: total,
                    offer_url: offerUrl,
                });
            });

            // Dedupe by shop name + price
            const seen = new Set();
            return offers.filter(o => {
                const key = `${o.shop_name}-${o.price}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        // Extract product data from HTML as fallback
        function extractProductFromHtml($, url) {
            const title = $('h1').first().text().trim();
            const brand = $('meta[itemprop="brand"]').attr('content') ||
                $('[class*="brand"]').first().text().trim() || null;

            // Get price from meta or visible elements
            let lowestPrice = null;
            const priceMeta = $('meta[itemprop="lowPrice"]').attr('content');
            if (priceMeta) {
                lowestPrice = cleanPrice(priceMeta);
            } else {
                const priceEl = $('[class*="price"]').first();
                if (priceEl.length) {
                    lowestPrice = cleanPrice(priceEl.text());
                }
            }

            // Get highest price
            let highestPrice = null;
            const highPriceMeta = $('meta[itemprop="highPrice"]').attr('content');
            if (highPriceMeta) {
                highestPrice = cleanPrice(highPriceMeta);
            }

            // Get offer count
            let offerCount = null;
            const offerCountMeta = $('meta[itemprop="offerCount"]').attr('content');
            if (offerCountMeta) {
                offerCount = parseInt(offerCountMeta, 10);
            } else {
                const offerText = $('[href="#offers"], [class*="offer-count"]').text();
                const offerMatch = offerText.match(/(\d+)\s*Angebote?/i);
                if (offerMatch) {
                    offerCount = parseInt(offerMatch[1], 10);
                }
            }

            // Get image
            const imageUrl = $('meta[property="og:image"]').attr('content') ||
                $('img[class*="product"]').attr('src') || null;

            // Get rating
            let rating = null;
            let reviewCount = null;
            const ratingMeta = $('meta[itemprop="ratingValue"]').attr('content');
            if (ratingMeta) {
                rating = parseFloat(ratingMeta);
            }
            const reviewMeta = $('meta[itemprop="reviewCount"]').attr('content');
            if (reviewMeta) {
                reviewCount = parseInt(reviewMeta, 10);
            }

            return {
                product_name: title || null,
                brand,
                gtin: null,
                sku: null,
                lowest_price: lowestPrice,
                highest_price: highestPrice,
                offer_count: offerCount,
                rating,
                review_count: reviewCount,
                image_url: imageUrl,
                currency: 'EUR',
                description: $('meta[name="description"]').attr('content') || null,
            };
        }

        // Find product links from search results
        function findProductLinks($, base) {
            const links = new Set();
            $('a[href*="/pricelist/"], a[href*="/baseproducts/"], a[href*="/products/"]').each((_, a) => {
                const href = $(a).attr('href');
                if (!href) return;
                const abs = toAbs(href, base);
                if (abs && !abs.includes('#')) {
                    links.add(abs);
                }
            });
            return [...links];
        }

        // Find next page in search results
        function findNextPage($, base) {
            const nextBtn = $('a[aria-label*="Nächste"], a[class*="next"], a:contains("›"), a:contains("»")').first();
            if (nextBtn.length) {
                const href = nextBtn.attr('href');
                if (href) return toAbs(href, base);
            }
            return null;
        }

        // Determine URL type
        function getUrlType(url) {
            if (!url) return 'UNKNOWN';
            if (url.includes('/search')) return 'SEARCH';
            if (url.includes('/pricelist/')) return 'PRICELIST';
            if (url.includes('/baseproducts/')) return 'BASEPRODUCT';
            if (url.includes('/products/')) return 'PRODUCT';
            return 'UNKNOWN';
        }

        // Build initial URLs
        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) {
            initial.push(...startUrls.map(u => typeof u === 'string' ? u : u.url).filter(Boolean));
        }
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length && searchQuery) {
            initial.push(buildSearchUrl(searchQuery));
        }
        if (!initial.length) {
            initial.push(buildSearchUrl('laptop'));
        }

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        let saved = 0;
        const seenUrls = new Set();

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 2,
            useSessionPool: true,
            maxConcurrency: 10,
            requestHandlerTimeoutSecs: 30,
            navigationTimeoutSecs: 20,
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const urlType = getUrlType(request.url);
                const pageNo = request.userData?.pageNo || 1;

                // Handle search results
                if (urlType === 'SEARCH') {
                    const links = findProductLinks($, request.url);
                    crawlerLog.info(`Found ${links.length} product links on search page ${pageNo}`);

                    const remaining = RESULTS_WANTED - saved;
                    const toEnqueue = links.filter(l => !seenUrls.has(l)).slice(0, Math.max(0, remaining));

                    for (const link of toEnqueue) {
                        seenUrls.add(link);
                    }

                    if (toEnqueue.length) {
                        await enqueueLinks({ urls: toEnqueue, userData: { label: 'DETAIL' } });
                    }

                    if (saved + toEnqueue.length < RESULTS_WANTED) {
                        const next = findNextPage($, request.url);
                        if (next && !seenUrls.has(next)) {
                            seenUrls.add(next);
                            await enqueueLinks({ urls: [next], userData: { label: 'SEARCH', pageNo: pageNo + 1 } });
                        }
                    }
                    return;
                }

                // Handle product detail pages
                if (urlType === 'PRICELIST' || urlType === 'BASEPRODUCT' || urlType === 'PRODUCT' || request.userData?.label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;

                    try {
                        // Try JSON-LD first
                        const jsonLdArray = extractJsonLd($);
                        let productData = extractProductFromJsonLd(jsonLdArray);

                        // Fallback to HTML parsing
                        if (!productData || !productData.product_name) {
                            productData = extractProductFromHtml($, request.url);
                        }

                        // Merge HTML data if JSON-LD is missing fields
                        if (productData) {
                            const htmlData = extractProductFromHtml($, request.url);
                            if (!productData.lowest_price && htmlData.lowest_price) {
                                productData.lowest_price = htmlData.lowest_price;
                            }
                            if (!productData.highest_price && htmlData.highest_price) {
                                productData.highest_price = htmlData.highest_price;
                            }
                            if (!productData.offer_count && htmlData.offer_count) {
                                productData.offer_count = htmlData.offer_count;
                            }
                            if (!productData.image_url && htmlData.image_url) {
                                productData.image_url = htmlData.image_url;
                            }
                        }

                        if (!productData || !productData.product_name) {
                            crawlerLog.warning(`Could not extract product data from ${request.url}`);
                            return;
                        }

                        // Extract individual offers if requested
                        let offers = [];
                        if (collectOffers) {
                            offers = extractOffersFromHtml($, request.url);
                        }

                        const item = {
                            product_name: productData.product_name,
                            brand: productData.brand,
                            gtin: productData.gtin,
                            sku: productData.sku,
                            lowest_price: productData.lowest_price,
                            highest_price: productData.highest_price,
                            offer_count: productData.offer_count,
                            rating: productData.rating,
                            review_count: productData.review_count,
                            image_url: productData.image_url,
                            currency: productData.currency,
                            product_url: request.url,
                            offers: collectOffers ? offers : undefined,
                            scraped_at: new Date().toISOString(),
                        };

                        await Dataset.pushData(item);
                        saved++;
                        crawlerLog.info(`Saved ${saved}/${RESULTS_WANTED}: ${productData.product_name}`);
                    } catch (err) {
                        crawlerLog.error(`Failed: ${err.message}`);
                    }
                }
            },
        });

        await crawler.run(initial.map(u => ({
            url: u,
            userData: {
                label: getUrlType(u) === 'SEARCH' ? 'SEARCH' : 'DETAIL',
                pageNo: 1
            }
        })));

        log.info(`Finished. Saved ${saved} products`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
