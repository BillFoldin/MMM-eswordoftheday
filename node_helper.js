const NodeHelper = require("node_helper")
const axios = require("axios")
const cheerio = require("cheerio")

/**
 * Fetch Spanish pronunciation MP3 using SoundOfText CDN or Google fallback
 */
async function fetchSpanishAudio(text) {
  if (!text || typeof text !== "string") return null
  const cleanText = text.trim()

  // Primary: SoundOfText API (produces high-quality Spanish speech hosted on Cloud CDN)
  try {
    const postRes = await axios.post(
      "https://api.soundoftext.com/sounds",
      {
        engine: "Google",
        data: { text: cleanText, voice: "es-ES" },
      },
      { timeout: 7000 }
    )

    if (postRes.data && postRes.data.id) {
      const soundId = postRes.data.id
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const statusRes = await axios.get(`https://api.soundoftext.com/sounds/${soundId}`, { timeout: 5000 })
        if (statusRes.data && statusRes.data.status === "Done") {
          const cdnUrl = statusRes.data.location
          const audioBufferRes = await axios.get(cdnUrl, { responseType: "arraybuffer", timeout: 7000 })
          return {
            url: cdnUrl,
            dataUrl: "data:audio/mpeg;base64," + Buffer.from(audioBufferRes.data).toString("base64"),
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[MMM-eswordoftheday] SoundOfText audio fetch error for "${cleanText}":`, err.message)
  }

  // Secondary Fallback: Direct Google Translate TTS endpoint
  try {
    const fallbackUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encodeURIComponent(cleanText)}`
    const res = await axios.get(fallbackUrl, {
      headers: {
        Referer: "http://translate.google.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      responseType: "arraybuffer",
      timeout: 6000,
    })
    return {
      url: fallbackUrl,
      dataUrl: "data:audio/mpeg;base64," + Buffer.from(res.data).toString("base64"),
    }
  } catch (err) {
    console.warn(`[MMM-eswordoftheday] Direct TTS fallback error:`, err.message)
    return null
  }
}

module.exports = NodeHelper.create({
  socketNotificationReceived: function (notification, payload) {
    if (notification === "MMM-eswordoftheday-GET_WORD") {
      const url = "https://www.spanishdict.com/wordoftheday"

      axios
        .get(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          timeout: 8000,
        })
        .then(async ({ data }) => {
          const $ = cheerio.load(data)

          const wotdContainer = $("h3").first()
          const wotd = wotdContainer.text().trim()
          const translation = wotdContainer.next().text().trim()

          let spanishExample = ""
          let englishExample = ""
          const exampleContainer = $(".YRbPpWPt").first()

          if (exampleContainer.length) {
            spanishExample = exampleContainer.find(".jxXGMKma").text().trim()
            englishExample = exampleContainer
              .find(".B8zBqhO4")
              .text()
              .trim()
              .replace(/^.*—\s*/, "")
          }

          // Pre-fetch pronunciation audio for word and example sentence
          const [wordAudioObj, exampleAudioObj] = await Promise.all([
            fetchSpanishAudio(wotd),
            spanishExample ? fetchSpanishAudio(spanishExample) : null,
          ])

          const translationData = {
            word: wotd,
            translation: translation,
            spanishExample: spanishExample,
            englishExample: englishExample,
            wordAudio: wordAudioObj ? wordAudioObj.dataUrl : null,
            wordAudioUrl: wordAudioObj ? wordAudioObj.url : null,
            exampleAudio: exampleAudioObj ? exampleAudioObj.dataUrl : null,
            exampleAudioUrl: exampleAudioObj ? exampleAudioObj.url : null,
          }

          console.log(
            `[MMM-eswordoftheday] Scraped: "${translationData.word}", Audio Ready: ${Boolean(translationData.wordAudio)}`
          )

          this.sendSocketNotification("MMM-eswordoftheday-RETURN_WORD", translationData)
        })
        .catch((error) => {
          console.error("[MMM-eswordoftheday] Scraper error:", error.message)
        })
    }
  },
})