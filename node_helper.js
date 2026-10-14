const NodeHelper = require("node_helper")
const axios = require("axios")
const cheerio = require("cheerio")
const { exec } = require("child_process")
const fs = require("fs")
const path = require("path")

async function fetchAudioDataUrl(text) {
  if (!text || typeof text !== "string") return null
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encodeURIComponent(text.trim())}`
    const res = await axios.get(url, {
      headers: {
        Referer: "http://translate.google.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      responseType: "arraybuffer",
      timeout: 5000,
    })
    return "data:audio/mpeg;base64," + Buffer.from(res.data).toString("base64")
  } catch (err) {
    console.warn(`[MMM-eswordoftheday] Could not fetch audio for "${text}":`, err.message)
    return null
  }
}

function playOnSystemSpeaker(base64Audio, callback) {
  if (!base64Audio) return
  const tempFile = path.join("/tmp", "wotd_speech.mp3")
  const rawBase64 = base64Audio.replace(/^data:audio\/\w+;base64,/, "")
  fs.writeFile(tempFile, Buffer.from(rawBase64, "base64"), (err) => {
    if (err) {
      console.error("[MMM-eswordoftheday] Error writing temp audio file:", err.message)
      return
    }
    // Probe available command-line audio players on Raspberry Pi / Linux
    exec("which mpg123 || which play || which cvlc || which ffplay || which omxplayer", (probeErr, stdout) => {
      if (probeErr || !stdout || !stdout.trim()) {
        console.warn("[MMM-eswordoftheday] No command-line audio player (mpg123/play/cvlc/ffplay) found on system.")
        return
      }
      const playerPath = stdout.trim().split("\n")[0]
      let command = ""
      if (playerPath.endsWith("mpg123")) command = `mpg123 -q ${tempFile}`
      else if (playerPath.endsWith("play")) command = `play -q ${tempFile}`
      else if (playerPath.endsWith("cvlc")) command = `cvlc --play-and-exit ${tempFile} > /dev/null 2>&1`
      else if (playerPath.endsWith("ffplay")) command = `ffplay -nodisp -autoexit -loglevel quiet ${tempFile}`
      else if (playerPath.endsWith("omxplayer")) command = `omxplayer -o both ${tempFile} > /dev/null 2>&1`

      if (command) {
        console.log(`[MMM-eswordoftheday] Executing system playback: ${command}`)
        exec(command, (execErr) => {
          if (execErr) console.warn("[MMM-eswordoftheday] System playback error:", execErr.message)
          if (typeof callback === "function") callback()
        })
      }
    })
  })
}

module.exports = NodeHelper.create({
  // Expose extra route for MagicMirror Express server
  extraRoutes: function () {
    const self = this
    if (this.expressApp) {
      this.expressApp.get("/MMM-eswordoftheday/tts", async function (req, res) {
        const text = req.query.text
        if (!text) {
          return res.status(400).send("No text provided")
        }
        try {
          const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encodeURIComponent(text.trim())}`
          const response = await axios.get(url, {
            headers: {
              Referer: "http://translate.google.com/",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            responseType: "stream",
          })
          res.setHeader("Content-Type", "audio/mpeg")
          response.data.pipe(res)
        } catch (e) {
          console.error("[MMM-eswordoftheday] TTS proxy error:", e.message)
          res.status(500).send("TTS error")
        }
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
              .replace(/^.*—\s*/, "") // Remove "—" and preceding whitespace
          }

          // Pre-fetch pronunciation audio as Base64 Data URLs so Raspberry Pi / Linux can play without client speech engine
          const [wordAudio, exampleAudio] = await Promise.all([
            fetchAudioDataUrl(wotd),
            spanishExample ? fetchAudioDataUrl(spanishExample) : null,
          ])

          const translationData = {
            word: wotd,
            translation: translation,
            spanishExample: spanishExample,
            englishExample: englishExample,
            wordAudio: wordAudio,
            exampleAudio: exampleAudio,
          }

          console.log("[MMM-eswordoftheday] Fetched word:", translationData.word, "Audio ready:", Boolean(wordAudio))

          this.sendSocketNotification(
            "MMM-eswordoftheday-RETURN_WORD",
            translationData
          )
        })
        .catch((error) => {
          console.error("[MMM-eswordoftheday] Error fetching data:", error.message)
        })
    } else if (notification === "MMM-eswordoftheday-SYSTEM_SPEAK") {
      const audioData = payload && payload.audioData
      const text = payload && payload.text
      if (audioData) {
        playOnSystemSpeaker(audioData)
      } else if (text) {
        fetchAudioDataUrl(text).then((dataUrl) => {
          if (dataUrl) playOnSystemSpeaker(dataUrl)
        })
      }
    }
  },
})