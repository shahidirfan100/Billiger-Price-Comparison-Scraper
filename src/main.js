// Billiger.de Price Comparison Scraper - CheerioCrawler implementation
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
            if (!priceStr) return null;
            const match = String(priceStr).replace(/\s/g, '').match(/(\d+[.,]?\d*)/);
            if (match) {
                return parseFloat(match[1].replace(',', '.'));
            }
            return null;
        };

        const cleanImageUrl = (url) => {
            if (!url) return null;
            try {
                const u = new URL(url);
                return `${u.origin}${u.pathname}`;
            } catch {
                return url;
            }
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
                    
                    return {
                        product_name: item.name || null,
                        brand: item.brand?.name || item.brand || null,
                        gtin: item.gtin13 || item.gtin || null,
                        sku: item.sku || null,
                        lowest_price: cleanPrice(offers.lowPrice),
                        highest_price: cleanPrice(offers.highPrice),
                        offer_count: parseInt(offers.offerCount, 10) || null,
                        rating: parseFloat(aggregateRating.ratingValue) || null,
                        review_count: parseInt(aggregateRating.reviewCount, 10) || null,
                        image_url: cleanImageUrl(Array.isArray(item.image) ? item.image[0] : item.image),
                        currency: offers.priceCurrency || 'EUR',
                        description: item.description || null,
                        variants: item.hasVariant ? item.hasVariant.map(v => ({
                            name: v.name,
                            sku: v.sku,
                            gtin: v.gtin13 || v.gtin,
                            url: v.url,
                            lowest_price: cleanPrice(v.offers?.lowPrice),
                            offer_count: parseInt(v.offers?.offerCount, 10) || null,
                        })) : [],
                    };
                }
            }
            return null;
        }

        // Extract individual offers from HTML
        function extractOffersFromHtml($) {
            const offers = [];
            
            // Look for offer rows
            $('[data-offer-row], .offer-row, [class*="offer-item"]').each((_, el) => {
                const $el = $(el);
                
                // Extract shop name
                const shopBtn = $el.find('button[title="Shop-Info"]');
                let shopName = shopBtn.attr('aria-label') || '';
                shopName = shopName.replace('Shop-Informationen', '').replace('für', '').trim();
                
                if (!shopName) {
                    shopName = $el.find('img[alt]').attr('alt') || '';
                }
                
                // Extract prices
                const priceText = $el.text();
                const priceMatch = priceText.match(/(\d+[.,]\d{2})\s*€/);
                const price = priceMatch ? cleanPrice(priceMatch[1]) : null;
                
                // Extract shipping
                const shippingMatch = priceText.match(/(?:ab|zzgl\.)\s*(\d+[.,]\d{2})\s*€\s*Versand/i);
                const shipping = shippingMatch ? cleanPrice(shippingMatch[1]) : 0;
                
                // Extract total
                const totalMatch = priceText.match(/(\d+[.,]\d{2})\s*€\s*Gesamt/i);
                const total = totalMatch ? cleanPrice(totalMatch[1]) : (price ? price + (shipping || 0) : null);
                
                // Extract link
                const link = $el.find('a[href*="redirect"]').attr('href') || $el.find('a').attr('href');
                
                if (shopName && price) {
                    offers.push({
                        shop_name: shopName.trim(),
                        price,
                        shipping_cost: shipping,
                        total_price: total,
                        offer_url: toAbs(link),
                    });
                }
            });
            
            return offers;
        }

        // Extract product data from HTML as fallback
        function extractProductFromHtml($, url) {
            const title = $('h1').first().text().trim();
            const brand = $('meta[itemprop="brand"]').attr('content') || 
                         $('[class*="brand"]').first().text().trim() || null;
            
            // Try to get price from various selectors
            let lowestPrice = null;
            const priceEl = $('[class*="price"]').first();
            if (priceEl.length) {
                lowestPrice = cleanPrice(priceEl.text());
            }
            
            // Get offer count
            let offerCount = null;
            const offerText = $('[href="#offers"]').text();
            const offerMatch = offerText.match(/(\d+)\s*Angebote?/i);
            if (offerMatch) {
                offerCount = parseInt(offerMatch[1], 10);
            }
            
            // Get image
            const imageUrl = $('img[class*="product"]').attr('src') || 
                            $('meta[property="og:image"]').attr('content') || null;
            
            // Get rating
            let rating = null;
            let reviewCount = null;
            const ratingEl = $('[class*="rating"]').first();
            if (ratingEl.length) {
                const ratingText = ratingEl.text();
                const ratingMatch = ratingText.match(/(\d+[.,]?\d*)/);
                if (ratingMatch) rating = parseFloat(ratingMatch[1].replace(',', '.'));
            }
            
            return {
                product_name: title || null,
                brand,
                gtin: null,
                sku: null,
                lowest_price: lowestPrice,
                highest_price: null,
                offer_count: offerCount,
                rating,
                review_count: reviewCount,
                image_url: cleanImageUrl(imageUrl),
                currency: 'EUR',
                description: $('meta[name="description"]').attr('content') || null,
                variants: [],
            };
        }

        // Find product links from search results
        function findProductLinks($, base) {
            const links = new Set();
            
            // Look for product links in search results
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
            // Look for next page link
            const nextBtn = $('a[aria-label*="Nächste"], a[class*="next"], a:contains("›"), a:contains("»")').first();
            if (nextBtn.length) {
                const href = nextBtn.attr('href');
                if (href) return toAbs(href, base);
            }
            
            // Look for pagination with page numbers
            const currentPage = $('a[aria-current="page"], .pagination .active').first();
            if (currentPage.length) {
                const nextSibling = currentPage.parent().next().find('a').attr('href');
                if (nextSibling) return toAbs(nextSibling, base);
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
            initial.push(buildSearchUrl('laptop')); // Default search
        }

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        let saved = 0;
        const seenUrls = new Set();

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 60,
            additionalMimeTypes: ['application/json'],
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const urlType = getUrlType(request.url);
                const pageNo = request.userData?.pageNo || 1;

                crawlerLog.info(`Processing ${urlType} page: ${request.url}`);

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
                        await enqueueLinks({ 
                            urls: toEnqueue, 
                            userData: { label: 'DETAIL' } 
                        });
                    }

                    // Pagination
                    if (saved + toEnqueue.length < RESULTS_WANTED) {
                        const next = findNextPage($, request.url);
                        if (next && !seenUrls.has(next)) {
                            seenUrls.add(next);
                            await enqueueLinks({ 
                                urls: [next], 
                                userData: { label: 'SEARCH', pageNo: pageNo + 1 } 
                            });
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
                            crawlerLog.info('JSON-LD extraction failed, falling back to HTML parsing');
                            productData = extractProductFromHtml($, request.url);
                        }

                        if (!productData || !productData.product_name) {
                            crawlerLog.warning(`Could not extract product data from ${request.url}`);
                            return;
                        }

                        // Extract individual offers if requested
                        let offers = [];
                        if (collectOffers) {
                            offers = extractOffersFromHtml($);
                            crawlerLog.info(`Extracted ${offers.length} individual offers`);
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
                        crawlerLog.info(`Saved product ${saved}/${RESULTS_WANTED}: ${productData.product_name}`);
                    } catch (err) {
                        crawlerLog.error(`Failed to extract from ${request.url}: ${err.message}`);
                    }
                }
            },
            async failedRequestHandler({ request, log: crawlerLog }) {
                crawlerLog.error(`Request failed: ${request.url}`);
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
