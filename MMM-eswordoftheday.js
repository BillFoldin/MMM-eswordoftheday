Module.register("MMM-eswordoftheday", {
  defaults: {
    updateInterval: 6 * 60 * 60 * 1000, // 6 hours in milliseconds
    retryDelay: 5000,
    showExamples: true,
    showExampleTranslations: true,
    showAudio: true,
    audioMode: "all", // "all", "browser", "system", "notification"
  },

  start: function () {
    Log.info(`Starting module: ${this.name}`)
    this.apiData = null
    this.audioElement = null
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
      Log.info("Received Word of the Day:", payload)
      this.apiData = payload
      this.updateDom()
    }
  },

  getSpeakerSvg: function (size = 20) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`
  },

  /**
   * Main audio handler supporting Browser Audio, System Audio (mpg123/espeak), and MMM-TTS broadcast
   */
  handlePlaySpeech: function (type, text, audioSource, buttonElement = null) {
    if (buttonElement) {
      buttonElement.classList.add("speaking")
    }

    const stopSpeakingUi = () => {
      if (buttonElement) {
        buttonElement.classList.remove("speaking")
      }
    }

    const mode = this.config.audioMode || "all"

    // 1. Send MagicMirror Notification to other TTS modules (MMM-TTS, MMM-GoogleTTS)
    if (mode === "all" || mode === "notification") {
      this.sendNotification("MMM-TTS", text)
    }

    // 2. Request native Raspberry Pi hardware audio via node_helper (mpg123 / espeak)
    if (mode === "all" || mode === "system") {
      this.sendSocketNotification("MMM-eswordoftheday-PLAY_SYSTEM_AUDIO", {
        type: type, // "word" or "example"
        text: text,
      })
    }

    // 3. Play via Browser/Electron Audio Element
    if (mode === "all" || mode === "browser") {
      try {
        if (!this.audioElement) {
          this.audioElement = new Audio()
        }

        const sourceUrl =
          audioSource ||
          (this.apiData && (type === "word" ? this.apiData.wordAudioUrl : this.apiData.exampleAudioUrl)) ||
          `/MMM-eswordoftheday/tts?text=${encodeURIComponent(text)}`

        this.audioElement.src = sourceUrl
        this.audioElement.onended = stopSpeakingUi
        this.audioElement.onerror = () => {
          stopSpeakingUi()
        }

        const playPromise = this.audioElement.play()
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn("[MMM-eswordoftheday] Browser audio.play() prevented:", err.message)
            stopSpeakingUi()
          })
        }
      } catch (err) {
        console.warn("[MMM-eswordoftheday] Browser audio exception:", err)
        stopSpeakingUi()
      }
    }

    // Reset button animation after appropriate duration
    const timeoutDuration = text.length > 25 ? 4000 : 2500
    setTimeout(stopSpeakingUi, timeoutDuration)
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
          this.handlePlaySpeech("word", this.apiData.word, this.apiData.wordAudio, wordSpeakerBtn)
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
            this.handlePlaySpeech("example", this.apiData.spanishExample, this.apiData.exampleAudio, esSpeakerBtn)
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