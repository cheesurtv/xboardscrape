const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { chromium } = require("playwright");

const app = express();
app.use(cors());
app.use(express.json());

// Ensure the images folder exists
const imagesDir = path.join(__dirname, "images");
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir);
}

app.post("/scrape", async (req, res) => {
    try {
        const { communityURL } = req.body;
        if (!communityURL || !communityURL.includes("x.com/i/communities/")) {
            return res.status(400).json({ error: "Invalid X community URL" });
        }

        console.log("Starting scraping for:", communityURL);
        const browser = await chromium.launch({ headless: true });
        let page;

        try {
            page = await browser.newPage();
            await page.goto(communityURL, { waitUntil: "domcontentloaded", timeout: 30000 });

            try {
                await page.waitForSelector('h2', { timeout: 10000 });
            } catch (err) {
                console.warn("h2 not found, continuing with null values.");
            }

            const scrapedData = await page.evaluate(() => {
                const imageSelectors = [
                    'img[src*="pbs.twimg.com"]',
                    'img[alt*="community"]',
                    'img[data-testid="communityAvatar"]'
                ];

                let profileImage = null;
                for (const selector of imageSelectors) {
                    const img = document.querySelector(selector);
                    if (img && img.src) {
                        profileImage = img.src;
                        break;
                    }
                }

                let communityName = null;
                const primaryColumn = document.querySelector('div[data-testid="primaryColumn"]');
                if (primaryColumn) {
                    const nameElement = primaryColumn.querySelector('h2');
                    if (nameElement) {
                        communityName = nameElement.textContent?.trim();
                    }
                }

                return { imageUrl: profileImage, communityName };
            });

            // Download and save the image locally
            if (scrapedData.imageUrl) {
                const imageExt = path.extname(new URL(scrapedData.imageUrl).pathname).split("?")[0] || ".jpg";
                const imageName = `community_${Date.now()}${imageExt}`;
                const imagePath = path.join(imagesDir, imageName);

                const response = await axios({
                    method: "GET",
                    url: scrapedData.imageUrl,
                    responseType: "stream",
                });

                await new Promise((resolve, reject) => {
                    const writer = fs.createWriteStream(imagePath);
                    response.data.pipe(writer);
                    writer.on("finish", resolve);
                    writer.on("error", reject);
                });

                scrapedData.imageUrl = `/images/${imageName}`;
            }

            console.log("Scraped Data:", scrapedData);
            res.json(scrapedData);

        } catch (error) {
            console.error("Error during scraping:", error);
            res.status(500).json({ error: "Failed to fetch image and name: " + error.message });
        } finally {
            if (page) await page.close();
            await browser.close();
            console.log("Browser closed");
        }
    } catch (error) {
        console.error("Request processing error:", error);
        res.status(500).json({ error: "Request processing error: " + error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Scraper running on port ${PORT}`);
});
