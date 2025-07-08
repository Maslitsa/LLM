# LLM - Kazakh Academic Writing Assistant Pipeline

Welcome to the **LLM** repository! This project contains a Node.js script that utilizes OpenAI's GPT models to improve Kazakh academic writing by iteratively refining text prompts and responses. It’s designed to help academic writers create polished, culturally and semantically accurate content.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Usage](#usage)
- [Input File Format](#input-file-format)
- [Output](#output)
- [Project Structure](#project-structure)
- [Dependencies](#dependencies)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Contact](#contact)

---

## Overview

The core script `try_final.js`:

- Processes input samples consisting of prompts and corresponding academic responses.
- Rewrites prompts from questions to formal academic statements.
- Ensures sentence completeness and academic style consistency.
- Generates concluding paragraphs using culturally relevant Kazakh academic language.
- Categorizes common writing issues and automatically improves the text.
- Runs multiple passes to iteratively validate and self-correct the writing.
- Produces a polished output file with improved samples and a summary report.

---

## Features

- Complete Kazakh academic text improvement pipeline.
- Safe JSON parsing with [json5](https://www.npmjs.com/package/json5).
- OpenAI API integration with retry-on-rate-limit logic.
- Automatically generates improved questions from responses.
- Includes both grammar/spelling correction and semantic validation.
- Supports debugging mode for detailed logs.

---

## Prerequisites

- [Node.js](https://nodejs.org/) (version 16 or higher recommended)
- An OpenAI API key with access to the `gpt-4o-mini` or similar GPT models.

---

## Setup

1. **Clone this repository:**

```bash
git clone https://github.com/Maslitsa/LLM.git 
cd LLM
```

2. **Install dependencies:**

```bash
npm install
```

3. **Create your environment file:**

```bash
cp .env.example .env
```

Then open `.env` and **replace the placeholder with your actual OpenAI API key:**

```env
OPEN_AI_KEY=your_openai_api_key_here   # Replace with your actual key
DEBUG=0                                # Set to 1 for debug logs
```

---

## Usage

Run the main script:

```bash
node try_final.js
```

- If `input.txt` does not exist, the script creates a stub for you to edit.
- After running, improved samples and a summary are written to `output.txt`.

---

## Input File Format (`input.txt`)

Each sample should follow this format:

```
<SAMPLE>
<PROMPT> What are the effects of cognitive dissonance in decision making?
<RESPONSE> Cognitive dissonance creates discomfort which motivates change.
<DOMAIN> Cognitive Sciences
<SOURCE> Example Source
```

You can add multiple `<SAMPLE>` sections in a single file.

---

## Output (`output.txt`)

- Contains the improved `<SAMPLE>` sections with polished prompts and responses.
- Ends with a summary: number of processed samples, success/fail count, and elapsed time.

---

## Project Structure

```
LLM/
├── try_final.js       # Main processing script
├── input.txt          # Input samples (auto-created if missing)
├── output.txt         # Output with improved samples
├── package.json       # Project manifest
├── .env.example       # Example environment config
└── README.md          # Documentation (this file)
```

---

## Dependencies

- `openai` – OpenAI API client
- `dotenv` – Environment variable loader
- `json5` – JSON parser with relaxed syntax

Install them with:

```bash
npm install
```

---

## Troubleshooting

- **Missing `OPEN_AI_KEY`**: Ensure your `.env` file exists and contains a valid API key.
- **Rate limiting**: The script retries automatically on rate limit errors. Reduce request frequency if needed.
- **Debug logs**: Set `DEBUG=1` in `.env` for detailed logs.
- **Unexpected JSON errors**: Make sure your input follows the correct format and is free of extra characters.

---

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.

---

## Contact

Developed by **Miras a.k.a. Maslitsa**

Open an issue or reach out via GitHub if you have questions or need support.

Thank you for using **LLM**! We hope it helps you create excellent Kazakh academic writing efficiently.
