Module.register("MMM-eswordoftheday", {
  defaults: {
    updateInterval: 6 * 60 * 60 * 1000, // 6 hours in milliseconds
    retryDelay: 5000,
    showExamples: true,
    showExampleTranslations: true,
    showAudio: true,
    useSystemAudio: false, // Set to true to use Raspberry Pi native audio player (mpg123)
  },

  start: function () {
    Log.info(`Starting module: ${this.name}`)
    this.apiData = null
    this.sendSocketNotification("MMM-eswordoftheday-GET_WORD", {})
    setInterval(() => {
      this.sendSocketNotification("MMM-eswordoftheday-GET_WORD", {})
    }, this.config.updateInterval)
  },

  getHeader: function () {
    return "Spanish Word of the Day"
  },

  getStyles: function () {
    return ["MMM-eswordoftheday.css"]
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "MMM-eswordoftheday-RETURN_WORD") {
      Log.info("Received:", payload)
      this.apiData = payload
      this.updateDom()
    }
  },

  getSpeakerSvg: function (size = 20) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`
  },

  playAudio: function (audioDataUrl, text, buttonElement = null) {
    if (buttonElement) {
      buttonElement.classList.add("speaking")
    }

    const stopSpeakingUi = () => {
      if (buttonElement) {
        buttonElement.classList.remove("speaking")
      }
    }

    // If configured to use native system audio on Raspberry Pi (e.g. mpg123)
    if (this.config.useSystemAudio === true) {
      this.sendSocketNotification("MMM-eswordoftheday-SYSTEM_SPEAK", {
        audioData: audioDataUrl,
        text: text,
      })
      setTimeout(stopSpeakingUi, text.length > 25 ? 4000 : 2500)
      return
    }

    // 1. PRIMARY: Base64 audio pre-rendered by node_helper (works directly on Raspberry Pi / Linux without client TTS engine)
    if (audioDataUrl && typeof audioDataUrl === "string" && audioDataUrl.startsWith("data:audio")) {
      try {
        const audio = new Audio(audioDataUrl)
        audio.onended = stopSpeakingUi
        audio.onerror = () => {
          this.sendSocketNotification("MMM-eswordoftheday-SYSTEM_SPEAK", { audioData: audioDataUrl, text: text })
          this.fallbackSpeech(text, buttonElement)
        }
        const playPromise = audio.play()
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn("[MMM-eswordoftheday] Direct audio playback error, falling back to system audio:", err)
            this.sendSocketNotification("MMM-eswordoftheday-SYSTEM_SPEAK", { audioData: audioDataUrl, text: text })
            this.fallbackSpeech(text, buttonElement)
          })
        }
        return
      } catch (e) {
        console.warn("[MMM-eswordoftheday] Exception playing data URL audio:", e)
      }
    }

    // 2. Secondary fallback
    this.sendSocketNotification("MMM-eswordoftheday-SYSTEM_SPEAK", { audioData: audioDataUrl, text: text })
    this.fallbackSpeech(text, buttonElement)
  },

  fallbackSpeech: function (text, buttonElement = null) {
    const stopSpeakingUi = () => {
      if (buttonElement) {
        buttonElement.classList.remove("speaking")
      }
    }

    // Try server/module route first
    const ttsRoute =
      window.location.port === "3000"
        ? `/api/tts?text=${encodeURIComponent(text)}&lang=es`
        : `/MMM-eswordoftheday/tts?text=${encodeURIComponent(text)}`

    try {
      const audio = new Audio(ttsRoute)
      audio.onended = stopSpeakingUi
      audio.onerror = () => {
        this.synthesizeSpeech(text, buttonElement)
      }
      const playPromise = audio.play()
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          this.synthesizeSpeech(text, buttonElement)
        })
      }
    } catch (e) {
      this.synthesizeSpeech(text, buttonElement)
    }
  },

  synthesizeSpeech: function (text, buttonElement = null) {
    const stopSpeakingUi = () => {
      if (buttonElement) {
        buttonElement.classList.remove("speaking")
      }
    }

    if (!("speechSynthesis" in window)) {
      stopSpeakingUi()
      return
    }

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume()
      }
      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = "es-ES"
      utterance.rate = 0.9

      const voices = window.speechSynthesis.getVoices()
      const spanishVoice = voices.find(
        (v) => v.lang && (v.lang.toLowerCase().startsWith("es-") || v.lang.toLowerCase() === "es")
      )
      if (spanishVoice) {
        utterance.voice = spanishVoice
      }

      utterance.onend = stopSpeakingUi
      utterance.onerror = stopSpeakingUi
      window.speechSynthesis.speak(utterance)
    } catch (e) {
      console.error("[MMM-eswordoftheday] Speech synthesis error:", e)
      stopSpeakingUi()
    }
  },

  getDom: function () {
    const wrapper = document.createElement("div")

    if (this.apiData) {
      // Spanish Word Row with Speaker Button
      const wordRow = document.createElement("div")
      wordRow.className = "word-row"

      const word = document.createElement("div")
      word.innerHTML = this.apiData.word
      word.className = "bold large"
      wordRow.appendChild(word)

      if (this.config.showAudio !== false && this.apiData.word) {
        const wordSpeakerBtn = document.createElement("button")
        wordSpeakerBtn.type = "button"
        wordSpeakerBtn.className = "speaker-btn speaker-btn-large"
        wordSpeakerBtn.title = "Play word pronunciation"
        wordSpeakerBtn.setAttribute("aria-label", `Play pronunciation for ${this.apiData.word}`)
        wordSpeakerBtn.innerHTML = this.getSpeakerSvg(24)
        wordSpeakerBtn.addEventListener("click", () => {
          this.playAudio(this.apiData.wordAudio, this.apiData.word, wordSpeakerBtn)
        })
        wordRow.appendChild(wordSpeakerBtn)
      }

      wrapper.appendChild(wordRow)

      // Translation
      const translation = document.createElement("div")
      translation.innerHTML = this.apiData.translation
      translation.className = "medium translation-text"
      wrapper.appendChild(translation)

      // Examples container
      if (this.config.showExamples && this.apiData.spanishExample) {
        const exampleContainer = document.createElement("div")
        exampleContainer.className = "small example-spacing"

        // Spanish Example Row with Speaker Button
        const esRow = document.createElement("div")
        esRow.className = "example-row"

        const es = document.createElement("div")
        es.innerHTML = this.apiData.spanishExample || "."
        es.className = "es-text"
        esRow.appendChild(es)

        if (this.config.showAudio !== false) {
          const esSpeakerBtn = document.createElement("button")
          esSpeakerBtn.type = "button"
          esSpeakerBtn.className = "speaker-btn speaker-btn-small"
          esSpeakerBtn.title = "Play sentence pronunciation"
          esSpeakerBtn.setAttribute("aria-label", "Play pronunciation for example sentence")
          esSpeakerBtn.innerHTML = this.getSpeakerSvg(16)
          esSpeakerBtn.addEventListener("click", () => {
            this.playAudio(this.apiData.exampleAudio, this.apiData.spanishExample, esSpeakerBtn)
          })
          esRow.appendChild(esSpeakerBtn)
        }

        exampleContainer.appendChild(esRow)

        // English Example Translation
        if (this.config.showExampleTranslations && this.apiData.englishExample) {
          const en = document.createElement("div")
          en.innerHTML = this.apiData.englishExample || "."
          en.className = "en-text"
          exampleContainer.appendChild(en)
        }

        wrapper.appendChild(exampleContainer)
      }
    } else {
      wrapper.innerHTML = "Loading..."
    }

    return wrapper
  },
})