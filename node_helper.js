const NodeHelper = require("node_helper")
const axios = require("axios")
const cheerio = require("cheerio")
const { exec } = require("child_process")
const fs = require("fs")
const path = require("path")

// Audio cache paths
const WORD_AUDIO_FILE = path.join("/tmp", "wotd_word.mp3")
const EXAMPLE_AUDIO_FILE = path.join("/tmp", "wotd_example.mp3")

/**
 * Fetch Spanish pronunciation MP3 using SoundOfText CDN or Google fallback
 */
async function fetchSpanishAudio(text) {
  if (!text || typeof text !== "string") return null
  const cleanText = text.trim()

  // Primary: SoundOfText API (produces high quality Google Spanish voice hosted on CDN)
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
            buffer: Buffer.from(audioBufferRes.data),
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[MMM-eswordoftheday] SoundOfText error for "${cleanText}":`, err.message)
  }

  // Secondary Fallback: Direct Google Translate TTS proxy with headers
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
      buffer: Buffer.from(res.data),
    }
  } catch (err) {
    console.warn(`[MMM-eswordoftheday] Direct Google TTS fallback error:`, err.message)
    return null
  }
}

/**
 * Play audio directly on Raspberry Pi hardware (bypassing browser audio context)
 */
function playAudioOnRaspberryPi(audioFilePath, fallbackText) {
  // Check if mpg123 is available to play the MP3 file
  if (audioFilePath && fs.existsSync(audioFilePath)) {
    exec("which mpg123 || which play || which cvlc || which ffplay || which omxplayer", (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        const player = stdout.trim().split("\n")[0]
        let playCmd = ""
        if (player.endsWith("mpg123")) playCmd = `mpg123 -q "${audioFilePath}"`
        else if (player.endsWith("play")) playCmd = `play -q "${audioFilePath}"`
        else if (player.endsWith("cvlc")) playCmd = `cvlc --play-and-exit "${audioFilePath}" > /dev/null 2>&1`
        else if (player.endsWith("ffplay")) playCmd = `ffplay -nodisp -autoexit -loglevel quiet "${audioFilePath}"`
        else if (player.endsWith("omxplayer")) playCmd = `omxplayer -o both "${audioFilePath}" > /dev/null 2>&1`

        if (playCmd) {
          console.log(`[MMM-eswordoftheday] Playing via local audio command: ${playCmd}`)
          return exec(playCmd, (pErr) => {
            if (pErr) console.warn("[MMM-eswordoftheday] Playback error:", pErr.message)
          })
        }
      }

      // If no MP3 player is installed, try native Linux speech synthesizer espeak
      speakWithEspeak(fallbackText)
    })
  } else {
    speakWithEspeak(fallbackText)
  }
}

function speakWithEspeak(text) {
  if (!text) return
  exec("which espeak-ng || which espeak", (err, stdout) => {
    if (!err && stdout && stdout.trim()) {
      const synth = stdout.trim().split("\n")[0]
      const cmd = `${synth} -v es-la -s 140 "${text.replace(/"/g, '\\"')}"`
      console.log(`[MMM-eswordoftheday] Speaking with local synthesizer: ${cmd}`)
      exec(cmd)
    }
  })
}

module.exports = NodeHelper.create({
  // Expose extraRoute for MagicMirror's Express server
  extraRoutes: function () {
    const self = this
    if (this.expressApp) {
      this.expressApp.get("/MMM-eswordoftheday/tts", async function (req, res) {
        const text = req.query.text
        if (!text) return res.status(400).send("Text required")
        const audio = await fetchSpanishAudio(text)
        if (audio && audio.buffer) {
          res.setHeader("Content-Type", "audio/mpeg")
          return res.send(audio.buffer)
        }
        res.status(500).send("Audio not available")
      })
    }
  },

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

          // Fetch audio for word and example
          const [wordAudioObj, exampleAudioObj] = await Promise.all([
            fetchSpanishAudio(wotd),
            spanishExample ? fetchSpanishAudio(spanishExample) : null,
          ])

          // Cache audio files locally on Raspberry Pi disk
          if (wordAudioObj && wordAudioObj.buffer) {
            fs.writeFile(WORD_AUDIO_FILE, wordAudioObj.buffer, () => {})
          }
          if (exampleAudioObj && exampleAudioObj.buffer) {
            fs.writeFile(EXAMPLE_AUDIO_FILE, exampleAudioObj.buffer, () => {})
          }

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
    } else if (notification === "MMM-eswordoftheday-PLAY_SYSTEM_AUDIO") {
      const type = payload && payload.type
      const text = payload && payload.text
      const audioFile = type === "word" ? WORD_AUDIO_FILE : EXAMPLE_AUDIO_FILE
      playAudioOnRaspberryPi(audioFile, text)
    }
  },
})