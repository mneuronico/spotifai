# SpotifAI

> AI Music, by humans

SpotifAI is a custom-built, single-page web application designed to host and stream a curated collection of original music made with AI tools like Suno and Udio. It serves as the primary portfolio for musical projects developed by **TOXI Media**, exploring the intersection of artificial intelligence and human creativity.

This is not just a standard music player; it's a lightweight, serverless platform built with vanilla HTML, CSS, and JavaScript, and deployed entirely on GitHub Pages.

---

## Features

* **Dynamic Album Loading:** Automatically discovers and lists all albums from a single `manifest.json`, generated at build time.
* **Responsive Player UI:** A clean, dark-mode interface inspired by modern streaming platforms, fully responsive for desktop and mobile.
* **Full Playback Controls:** Includes play/pause, next/prev, shuffle, loop, a seek bar, and volume control.
* **Album Carousel & Sorting:** Browse all available albums in a scroll-snapping carousel with multiple sorting options (e.g., Recommended, Date Added, Release Date, Title).
* **"Surprise Me" Mode:** A global shuffle button to generate and play a randomized queue of every track in the entire collection.
* **Deep-Linking:** Shareable URLs that link directly to a specific album or even a specific track.
* **Automated Deployment:** Deploys automatically to GitHub Pages on every push to the `main` branch.

---

## How It Works

This project is a static site that requires no backend.

1.  All music is organized into individual folders within the `/albums` directory.
2.  Each album folder contains its `.mp3` tracks (named `NN - Title.mp3`), a `cover.png`, and a `meta.json` file for artist and date information.
3.  On every push to `main`, a GitHub Action workflow executes the `node generate-manifest.mjs` script.
4.  This script scans the `/albums` directory, uses `ffprobe` (via `ffmpeg`) to get accurate track durations, and builds a single `manifest.json` file.
5.  The frontend JavaScript (`script.js`) fetches this `manifest.json` on load to dynamically build the entire player UI and track lists.

---

## How to Add a New Album

1.  Create a new folder inside the `/albums` directory (e.g., `/albums/My New Album`).
2.  Add your tracks, named in the `NN - Title.mp3` format (e.g., `01 - First Song.mp3`).
3.  Add a `cover.png` file (ideally square) to the album's folder.
4.  Create a `meta.json` file in the folder with the following structure:
    ```json
    {
      "artist": "Your Name",
      "date_released": "YYYY-MM-DD",
      "date_added": "YYYY-MM-DD",
      "recommended": false
    }
    ```
5.  Commit and push your changes. The GitHub Action will automatically re-build and deploy the site with the new album included.

---

## About the Author

This project and much of the music it hosts are developed and composed by **Nicolás Martorell**.

* **Email:** [mneuronico@gmail.com](mailto:mneuronico@gmail.com)
* **Role:** AI Researcher & Lead Developer at [**TOXI Media**](https://www.toxi.media)