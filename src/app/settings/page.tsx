"use client";

import React, { useState, useEffect } from "react";
import {
  Settings as SettingsIcon,
  Download,
  Upload,
  Server,
  FolderArchive,
  Database,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Key,
  Globe,
  Cpu,
  Eye,
  EyeOff,
  ExternalLink,
  Sparkles,
  Zap,
  HelpCircle,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ProviderPreset {
  id: string;
  name: string;
  badge: string;
  baseUrl: string;
  model: string;
  keyHelpUrl: string;
  keyPlaceholder: string;
  description: string;
}

const PRESETS: ProviderPreset[] = [
  {
    id: "google",
    name: "Google AI Studio",
    badge: "Free Tier Available",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    model: "gemini-2.0-flash",
    keyHelpUrl: "https://aistudio.google.com/app/apikey",
    keyPlaceholder: "AIzaSy...",
    description: "Gemini 2.0 Flash via Google's official OpenAI-compatible endpoint. Fast and high rate limits.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    badge: "All Models in One Key",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.0-flash-001",
    keyHelpUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-v1-...",
    description: "Access Gemini, Claude 3.5 Sonnet, DeepSeek R1/V3, Llama 3.3, and more with a single API key.",
  },
  {
    id: "openai",
    name: "OpenAI",
    badge: "Standard",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyHelpUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-proj-...",
    description: "Official OpenAI models including GPT-4o mini and GPT-4o.",
  },
  {
    id: "groq",
    name: "Groq Cloud",
    badge: "Ultra Fast",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyHelpUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_...",
    description: "Sub-second inference for Llama 3.3 70B and Mixtral.",
  },
  {
    id: "ollama",
    name: "Local Ollama",
    badge: "100% Offline & Private",
    baseUrl: "http://localhost:11434",
    model: "llama3.1",
    keyHelpUrl: "https://ollama.com",
    keyPlaceholder: "No key needed for local Ollama",
    description: "Runs completely locally on your hardware with no internet connection required.",
  },
  {
    id: "custom",
    name: "Custom OpenAI-Compatible",
    badge: "Self-Hosted / Other",
    baseUrl: "https://api.example.com/v1",
    model: "custom-model",
    keyHelpUrl: "",
    keyPlaceholder: "API key or token",
    description: "Any OpenAI-compatible server (LM Studio, vLLM, LocalAI, DeepSeek API, Together, etc.).",
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);

  // Form State
  const [selectedProvider, setSelectedProvider] = useState<string>("google");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  // Status & Testing State
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<{ text: string; success: boolean } | null>(null);

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings(data);

      // Determine initial selection based on saved settings
      if (data.openaiBaseUrl?.includes("googleapis.com")) {
        setSelectedProvider("google");
      } else if (data.openaiBaseUrl?.includes("openrouter.ai")) {
        setSelectedProvider("openrouter");
      } else if (data.openaiBaseUrl?.includes("groq.com")) {
        setSelectedProvider("groq");
      } else if (data.aiProvider === "ollama") {
        setSelectedProvider("ollama");
      } else if (data.openaiBaseUrl?.includes("openai.com")) {
        setSelectedProvider("openai");
      } else {
        setSelectedProvider("google");
      }

      setBaseUrlInput(data.openaiBaseUrl || "https://generativelanguage.googleapis.com/v1beta/openai/");
      setModelInput(data.openaiModel || "gemini-2.0-flash");
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSelectPreset = (preset: ProviderPreset) => {
    setSelectedProvider(preset.id);
    setBaseUrlInput(preset.baseUrl);
    setModelInput(preset.model);
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey: apiKeyInput,
          baseUrl: baseUrlInput,
          model: modelInput,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setTestResult({ success: true, message: data.message });
      } else {
        setTestResult({ success: false, message: data.error || "Connection test failed." });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || "Failed to reach test endpoint." });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const payload: Record<string, string> = {
        aiProvider: selectedProvider === "ollama" ? "ollama" : "openai",
        openaiBaseUrl: baseUrlInput.trim(),
        openaiModel: modelInput.trim(),
      };

      if (selectedProvider === "ollama") {
        payload.ollamaBaseUrl = baseUrlInput.trim();
        payload.ollamaModel = modelInput.trim();
      }

      if (apiKeyInput.trim()) {
        payload.openaiApiKey = apiKeyInput.trim();
      }

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setSaveSuccess(true);
        setApiKeyInput(""); // Clear input after save for security
        await loadSettings();
        setTimeout(() => setSaveSuccess(false), 4000);
      }
    } catch {
      // ignore
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearApiKey = async () => {
    if (!confirm("Remove the saved API key? The system will fallback to local Ollama or offline mode.")) return;
    setIsSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearApiKey: true }),
      });
      await loadSettings();
    } finally {
      setIsSaving(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;

    setIsImporting(true);
    setImportMessage(null);

    const formData = new FormData();
    formData.append("file", importFile);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (res.ok) {
        setImportMessage({ text: data.message || "Import completed successfully!", success: true });
        setImportFile(null);
      } else {
        setImportMessage({ text: data.error || "Failed to import file.", success: false });
      }
    } catch (err: any) {
      setImportMessage({ text: err.message || "Import error.", success: false });
    } finally {
      setIsImporting(false);
    }
  };

  const activePreset = PRESETS.find((p) => p.id === selectedProvider) || PRESETS[0];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0d1117] p-6 lg:p-10 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-blue-400" />
          <span>System Settings & BYOK (Bring Your Own Key)</span>
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Connect your own API key from Google AI Studio, OpenRouter, OpenAI, Groq, or run 100% locally with Ollama.
        </p>
      </div>

      {/* AI Provider Configuration with BYOK */}
      <Card className="border-zinc-800 bg-[#161b22]">
        <CardHeader className="border-b border-zinc-800/80 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-amber-400" />
              <div>
                <CardTitle className="text-base font-semibold text-white">
                  AI Provider & API Key (BYOK)
                </CardTitle>
                <p className="text-xs text-zinc-400">
                  Select your preferred AI provider or enter your own custom API key.
                </p>
              </div>
            </div>
            {settings && (
              <Badge variant="secondary" className="text-xs bg-blue-950/60 text-blue-300 border-blue-800/60 self-start sm:self-auto">
                Active Engine: {settings.activeProvider}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-6">
          {/* Preset Buttons Grid */}
          <div>
            <label className="text-xs font-semibold text-zinc-300 block mb-2">
              Choose Provider Preset:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {PRESETS.map((preset) => {
                const isSelected = selectedProvider === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`p-3 rounded-lg border text-left transition-all relative ${
                      isSelected
                        ? "border-blue-500 bg-blue-950/30 text-white shadow-sm"
                        : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs text-white">{preset.name}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded ${
                          preset.id === "google"
                            ? "bg-emerald-900/60 text-emerald-300 border border-emerald-700/50"
                            : preset.id === "openrouter"
                            ? "bg-purple-900/60 text-purple-300 border border-purple-700/50"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {preset.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configuration Form */}
          <form onSubmit={handleSaveSettings} className="space-y-4 pt-2 border-t border-zinc-850">
            {/* API Key Input */}
            {selectedProvider !== "ollama" && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-amber-400" />
                    API Key ({activePreset.name})
                  </label>
                  {activePreset.keyHelpUrl && (
                    <a
                      href={activePreset.keyHelpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 hover:underline"
                    >
                      Get your API key <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                <div className="relative">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={
                      settings?.hasOpenaiApiKey
                        ? `Stored key: ${settings.openaiApiKeyMasked} (leave blank to keep current)`
                        : activePreset.keyPlaceholder
                    }
                    className="bg-zinc-900 border-zinc-700 text-sm font-mono pr-20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 p-1"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-[11px] text-zinc-400">
                    Keys are stored securely in your local SQLite database and never sent to any telemetry server.
                  </p>
                  {settings?.hasOpenaiApiKey && (
                    <button
                      type="button"
                      onClick={handleClearApiKey}
                      className="text-[11px] text-red-400 hover:text-red-300 hover:underline shrink-0 ml-2"
                    >
                      Remove Key
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* API Base URL */}
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">
                API Base URL (OpenAI-Compatible Endpoint)
              </label>
              <Input
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder={activePreset.baseUrl}
                className="bg-zinc-900 border-zinc-700 text-sm font-mono"
              />
              <p className="text-[11px] text-zinc-400 mt-1">
                {selectedProvider === "google" && "Google AI Studio's official OpenAI-compatible endpoint."}
                {selectedProvider === "openrouter" && "OpenRouter's unified endpoint for all frontier models."}
                {selectedProvider === "ollama" && "Endpoint for your locally running Ollama instance."}
                {selectedProvider === "openai" && "Official OpenAI API endpoint."}
                {selectedProvider === "groq" && "Groq Cloud ultra-fast inference endpoint."}
                {selectedProvider === "custom" && "Custom OpenAI-compatible base URL (e.g. vLLM, LM Studio, etc.)."}
              </p>
            </div>

            {/* Model Name */}
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">
                Model Name
              </label>
              <Input
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                placeholder={activePreset.model}
                className="bg-zinc-900 border-zinc-700 text-sm font-mono"
              />
              <p className="text-[11px] text-zinc-400 mt-1">
                {selectedProvider === "google" && "Recommended: gemini-2.0-flash or gemini-1.5-flash."}
                {selectedProvider === "openrouter" && "Recommended: google/gemini-2.0-flash-001, deepseek/deepseek-chat, or anthropic/claude-3.5-sonnet."}
                {selectedProvider === "ollama" && "Recommended: llama3.1, qwen2.5-coder, or mistral."}
                {selectedProvider === "openai" && "Recommended: gpt-4o-mini or gpt-4o."}
                {selectedProvider === "groq" && "Recommended: llama-3.3-70b-versatile."}
                {selectedProvider === "custom" && "Enter the exact model identifier for your custom provider."}
              </p>
            </div>

            {/* Testing Result Message */}
            {testResult && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                  testResult.success
                    ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                    : "bg-red-950/40 border-red-800/50 text-red-300"
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Actions: Test Connection & Save */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="submit"
                disabled={isSaving}
                className="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white"
              >
                {isSaving ? "Saving..." : "Save AI Preferences"}
              </Button>

              <Button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || (selectedProvider !== "ollama" && !apiKeyInput && !settings?.hasOpenaiApiKey)}
                className="h-9 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-medium"
              >
                {isTesting ? "Testing Connection..." : "Test Connection"}
              </Button>

              {saveSuccess && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Updated & AI cache refreshed!
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Manual .env.local Setup Guide */}
      <Card className="border-zinc-800 bg-[#161b22]">
        <CardHeader className="border-b border-zinc-800/80 p-5">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-zinc-400" />
            <CardTitle className="text-sm font-semibold text-zinc-200">
              Alternative: Configure via <code>.env.local</code> file
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-5 text-xs text-zinc-400 space-y-2.5">
          <p>
            If you prefer setting environment variables in your deployment or Docker container, add these keys to your <code>.env.local</code> file:
          </p>
          <div className="rounded-md bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 border border-zinc-800 space-y-1">
            <p className="text-zinc-500"># For Google AI Studio (Gemini):</p>
            <p>AI_PROVIDER=openai</p>
            <p>OPENAI_API_KEY=AIzaSy...</p>
            <p>OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/</p>
            <p>OPENAI_MODEL=gemini-2.0-flash</p>
            <br />
            <p className="text-zinc-500"># Or for OpenRouter:</p>
            <p>AI_PROVIDER=openai</p>
            <p>OPENAI_API_KEY=sk-or-v1-...</p>
            <p>OPENAI_BASE_URL=https://openrouter.ai/api/v1</p>
            <p>OPENAI_MODEL=google/gemini-2.0-flash-001</p>
          </div>
        </CardContent>
      </Card>

      {/* Storage and Paths Information */}
      <Card className="border-zinc-800 bg-[#161b22]">
        <CardHeader className="border-b border-zinc-800/80 p-5">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-emerald-400" />
            <CardTitle className="text-base font-semibold text-white">
              Storage Architecture
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-5 space-y-4 text-xs text-zinc-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/60 gap-2">
            <div className="flex items-center gap-2.5">
              <FolderArchive className="h-4 w-4 text-amber-400 shrink-0" />
              <div>
                <span className="font-semibold text-white block">Markdown Vault Path</span>
                <span className="font-mono text-zinc-400 text-[11px]">
                  {settings?.vaultPath || "./vault"}
                </span>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0 border-zinc-700">
              Obsidian Compatible
            </Badge>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/60 gap-2">
            <div className="flex items-center gap-2.5">
              <Database className="h-4 w-4 text-blue-400 shrink-0" />
              <div>
                <span className="font-semibold text-white block">SQLite Metadata Database</span>
                <span className="font-mono text-zinc-400 text-[11px]">
                  {settings?.databasePath || "./data/myai.db"}
                </span>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0 border-zinc-700">
              FTS5 Enabled
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Export & Backup */}
      <Card className="border-zinc-800 bg-[#161b22]">
        <CardHeader className="border-b border-zinc-800/80 p-5">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-blue-400" />
            <CardTitle className="text-base font-semibold text-white">
              Export Knowledge Vault
            </CardTitle>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Export all your Markdown files as a portable ZIP archive. You own all your data.
          </p>
        </CardHeader>
        <CardContent className="p-5">
          <a href="/api/export" download>
            <Button className="h-9 gap-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs border border-zinc-700">
              <Download className="h-4 w-4" /> Download Vault as ZIP
            </Button>
          </a>
        </CardContent>
      </Card>

      {/* Import Existing Knowledge */}
      <Card className="border-zinc-800 bg-[#161b22]">
        <CardHeader className="border-b border-zinc-800/80 p-5">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base font-semibold text-white">
              Import Existing Notes or Vault
            </CardTitle>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Upload an existing <code>.md</code> file or an entire Obsidian vault ZIP. Files will be parsed and registered.
          </p>
        </CardHeader>
        <CardContent className="p-5">
          <form onSubmit={handleImport} className="space-y-4">
            <input
              type="file"
              accept=".md,.zip"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="block w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 cursor-pointer"
            />

            <Button
              type="submit"
              disabled={!importFile || isImporting}
              className="h-9 px-4 bg-purple-600 hover:bg-purple-700 text-white text-xs"
            >
              {isImporting ? "Processing and Indexing..." : "Start Import"}
            </Button>

            {importMessage && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                  importMessage.success
                    ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                    : "bg-red-950/40 border-red-800/50 text-red-300"
                }`}
              >
                {importMessage.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                )}
                <span>{importMessage.text}</span>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
