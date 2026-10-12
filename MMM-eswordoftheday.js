Module.register("MMM-eswordoftheday", {
  defaults: {
    updateInterval: 6 * 60 * 60 * 1000, // 6 hours in milliseconds
    retryDelay: 5000,
    showExamples: true,
    showExampleTranslations: true,
    showAudio: true,
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

  speakText: function (text, lang = "es-ES", buttonElement = null) {
    if (buttonElement) {
      buttonElement.classList.add("speaking");
    }

    const stopSpeakingUi = () => {
      if (buttonElement) {
        buttonElement.classList.remove("speaking");
      }
    };

    // Playback fallback via audio stream (essential for Debian/Raspberry Pi without local speech-dispatcher)
    const playFallbackAudio = () => {
      try {
        const isPreview = window.location.port === "3000" || window.location.pathname.includes("preview");
        const fallbackUrl = isPreview
          ? `/api/tts?text=${encodeURIComponent(text)}&lang=es`
          : `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encodeURIComponent(text)}`;
        const audio = new Audio(fallbackUrl);
        audio.onended = stopSpeakingUi;
        audio.onerror = stopSpeakingUi;
        audio.play().catch((err) => {
          console.warn("Audio element play error:", err);
          stopSpeakingUi();
        });
      } catch (err) {
        console.error("Audio fallback exception:", err);
        stopSpeakingUi();
      }
    };

    if (!("speechSynthesis" in window)) {
      playFallbackAudio();
      return;
    }

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.9; // Slightly slower for language learners

      const voices = window.speechSynthesis.getVoices();
      const spanishVoice = voices.find(
        (v) => v.lang && (v.lang.toLowerCase().startsWith("es-") || v.lang.toLowerCase() === "es")
      );

      // If voice list is loaded but lacks Spanish, or if voices is empty on Linux, fall back to audio stream
      if (voices.length > 0 && !spanishVoice) {
        playFallbackAudio();
        return;
      }

      if (spanishVoice) {
        utterance.voice = spanishVoice;
      }

      let hasStarted = false;
      utterance.onstart = function () {
        hasStarted = true;
      };
      utterance.onend = stopSpeakingUi;
      utterance.onerror = function (e) {
        console.warn("SpeechSynthesis error, falling back to audio stream:", e);
        playFallbackAudio();
      };

      // Fallback timer: on some Linux distributions, speech-dispatcher hangs silently if unconfigured
      setTimeout(() => {
        if (!hasStarted && buttonElement && buttonElement.classList.contains("speaking")) {
          window.speechSynthesis.cancel();
          playFallbackAudio();
        }
      }, 1200);

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("SpeechSynthesis exception, falling back to audio stream:", e);
      playFallbackAudio();
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
          this.speakText(this.apiData.word, "es-ES", wordSpeakerBtn)
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
            this.speakText(this.apiData.spanishExample, "es-ES", esSpeakerBtn)
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
