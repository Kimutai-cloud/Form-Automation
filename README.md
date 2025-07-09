# AI Form Automation Tool

A conversational AI-powered form automation tool that uses Puppeteer for web scraping and OpenAI for generating natural language questions. Built with clean architecture principles using TypeScript.

---

## 🚀 Features

- 🤖 **AI-Powered Questions**: Uses OpenAI GPT to generate natural, conversational questions for form fields  
- 🎯 **Smart Form Detection**: Automatically detects and extracts form fields from web pages  
- 🔧 **Configurable Tone**: Choose between casual and professional question styles  
- ✅ **Input Validation**: Validates user input based on field requirements and common patterns  
- 📊 **Comprehensive Logging**: Detailed logging with Winston for debugging and monitoring  
- 🏗️ **Clean Architecture**: Well-structured code following clean architecture principles  
- 💻 **Easy to Use**: Simple CLI interface for seamless interaction  

---

## 🧱 Architecture

The project follows Clean Architecture principles with the following layers:

```
src/
├── domain/              # Business Logic Layer
│   ├── entities/        # Core business entities
│   ├── repositories/    # Repository interfaces
│   └── services/        # Domain services
├── application/         # Use Cases Layer
│   ├── use-cases/       # Application use cases
│   └── interfaces/      # Application interfaces
├── infrastructure/      # External Dependencies Layer
│   ├── repositories/    # Repository implementations
│   ├── ui/              # User interface implementations
│   ├── config/          # Configuration management
│   └── logging/         # Logging implementation
└── presentation/        # Presentation Layer
    ├── controllers/     # Application controllers
    └── cli/             # CLI interface
```

---

## 📦 Prerequisites

- Node.js v18.0.0 or higher  
- npm or yarn package manager  
- OpenAI API key  

---

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd form-automation
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   FORM_TIMEOUT=30000
   HEADLESS_MODE=false
   LOG_LEVEL=info
   ```

---

## ⚙️ Usage

### Quick Start
```bash
npm start
```

### Development Mode
```bash
npm run dev
```

### Build and Run
```bash
npm run build
npm run start:prod
```

---

## 🔧 Configuration Options

### Environment Variables

| Variable           | Description                                      | Default                             |
|--------------------|--------------------------------------------------|-------------------------------------|
| `OPENAI_API_KEY`   | Your OpenAI API key                              | **Required**                        |
| `FORM_TIMEOUT`     | Timeout for form operations (ms)                 | `30000`                             |
| `HEADLESS_MODE`    | Run browser in headless mode                     | `false`                             |
| `LOG_LEVEL`        | Logging level                                    | `info`                              |
| `DEFAULT_FORM_URL` | Default form URL (e.g. Selenium demo form)       | *(optional)*                        |

### Runtime Prompts

- **Form URL**: Form to automate  
- **Tone**: Casual or professional  
- **Headless Mode**: true/false  
- **Timeout**: In milliseconds  

---

## ⚙️ How It Works

1. **Form Field Extraction**: Detects and parses visible form fields  
2. **Question Generation**: GPT generates questions based on field labels  
3. **User Interaction**: CLI prompts user and collects validated answers  
4. **Form Filling**: Puppeteer fills the form fields  
5. **Form Submission**: Form is submitted, results are logged  

---

## 🧾 Supported Form Elements

- `<input>` (text, email, password, etc.)
- `<textarea>`
- `<select>`
- Required field validation
- Email format validation

---

## 📋 Example Output
### Screenshot

![Form Automation Example](./screenshots/Example1.png)
![Form Automation Example](./screenshots/Example2.png)
![Form Automation Example](./screenshots/Example3.png)

---

### Layer Breakdown

- **Domain**: Pure business logic  
- **Application**: Use cases  
- **Infrastructure**: Puppeteer, OpenAI, logging  
- **Presentation**: CLI and controllers  

---

## 🧯 Error Handling

- **Validation Errors**: Clear messages for bad input  
- **Network Errors**: Retries with exponential backoff  
- **Browser Errors**: Graceful fallback  
- **LLM Failures**: Fallback questions when GPT fails  

---

## 📃 Logging

Powered by Winston:

- Human-friendly console logs
- File logs in `form-automation.log`
- JSON format for production environments

---

## ❗ Troubleshooting

### Common Issues

**OpenAI API Key Issues**
- Ensure API key is correct and active  
- Check usage limits and billing status