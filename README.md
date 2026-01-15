# Billiger Price Comparison Scraper

Extract product prices, offers, and specifications from Billiger.de — Germany's leading price comparison platform with millions of products from thousands of online shops.

## What does Billiger Scraper do?

This scraper helps you monitor product prices across German e-commerce by extracting:

- **Product information** — name, brand, GTIN/EAN, SKU, images
- **Price data** — lowest price, highest price, price history
- **Shop offers** — individual seller prices, shipping costs, total prices
- **Ratings and reviews** — aggregate ratings and review counts

Perfect for price monitoring, competitor analysis, market research, and e-commerce intelligence.

## Use Cases

- **Price Monitoring** — Track price changes for products you sell or want to buy
- **Competitor Analysis** — Monitor competitor pricing across German online shops
- **Market Research** — Analyze pricing trends and market positioning
- **Arbitrage Opportunities** — Find price differences between sellers
- **Product Data Enrichment** — Get GTIN, specifications, and images for your catalog

## Input

| Field | Type | Description |
|-------|------|-------------|
| `searchQuery` | String | Product name or keywords to search |
| `startUrl` | String | Direct Billiger.de product URL |
| `results_wanted` | Integer | Maximum products to scrape (default: 20) |
| `collectOffers` | Boolean | Include individual shop offers (default: true) |
| `proxyConfiguration` | Object | Proxy settings for reliable scraping |

### Example Input

```json
{
  "searchQuery": "iPhone 15 Pro",
  "results_wanted": 10,
  "collectOffers": true
}
```

Or scrape a specific product:

```json
{
  "startUrl": "https://www.billiger.de/pricelist/5292483897-asus-rog-zephyrus-g16",
  "collectOffers": true
}
```

## Output

Each product includes comprehensive pricing data:

```json
{
  "product_name": "Apple iPhone 15 Pro 256GB Titanium Black",
  "brand": "Apple",
  "gtin": "1234567890123",
  "sku": "MTQT3ZD/A",
  "lowest_price": 1149.00,
  "highest_price": 1399.00,
  "offer_count": 42,
  "rating": 4.8,
  "review_count": 156,
  "image_url": "https://images.billiger.de/...",
  "currency": "EUR",
  "product_url": "https://www.billiger.de/pricelist/...",
  "offers": [
    {
      "shop_name": "Amazon",
      "price": 1149.00,
      "shipping_cost": 0,
      "total_price": 1149.00,
      "offer_url": "https://www.billiger.de/redirect/..."
    }
  ],
  "scraped_at": "2026-01-15T12:00:00.000Z"
}
```

### Output Fields

| Field | Type | Description |
|-------|------|-------------|
| `product_name` | String | Full product name |
| `brand` | String | Manufacturer or brand |
| `gtin` | String | GTIN-13/EAN barcode |
| `sku` | String | Stock keeping unit |
| `lowest_price` | Number | Lowest available price in EUR |
| `highest_price` | Number | Highest available price in EUR |
| `offer_count` | Integer | Total number of shop offers |
| `rating` | Number | Average rating (1-5 scale) |
| `review_count` | Integer | Number of reviews |
| `image_url` | String | Product image URL |
| `currency` | String | Currency code (EUR) |
| `product_url` | String | Billiger.de product page URL |
| `offers` | Array | Individual shop offers (if enabled) |
| `scraped_at` | String | ISO timestamp of extraction |

## Cost Estimation

Running this scraper costs approximately:

| Results | Estimated Cost |
|---------|----------------|
| 20 products | ~$0.10 |
| 100 products | ~$0.40 |
| 500 products | ~$1.80 |

Costs depend on proxy usage and whether individual offers are collected.

## Tips for Best Results

1. **Use residential proxies** for most reliable results with German e-commerce sites
2. **Start with a specific search query** to get more relevant products
3. **Set reasonable limits** — start with 20-50 products to verify output
4. **Disable offer collection** if you only need aggregate pricing to speed up scraping

## Integrations

Export your data to:

- **Google Sheets** — Automatic sync for price monitoring dashboards
- **Webhooks** — Real-time notifications when prices change
- **API** — Access data programmatically via Apify API
- **Zapier/Make** — Connect to 1000+ apps for automation

## FAQ

**Q: Can I scrape specific product categories?**
A: Yes, use a search query like "gaming laptop" or "OLED TV" to focus on specific categories.

**Q: How often can I run the scraper?**
A: The scraper respects rate limits. For daily monitoring, schedule runs during off-peak hours.

**Q: What if a product has no offers?**
A: Products without offers are still saved with available metadata. The `offers` array will be empty.

**Q: Does it work with all Billiger.de products?**
A: Yes, the scraper works with electronics, appliances, fashion, beauty, and all other categories on Billiger.de.

## Support

For questions or issues, please open an issue on the actor's page or contact the developer.