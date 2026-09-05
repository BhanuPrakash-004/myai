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
  RefreshCw,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [modelInput, setModelInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<{ text: string; success: boolean } | null>(null);

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings(data);
      setModelInput(data.ollamaModel || "llama3.1");
      setUrlInput(data.ollamaBaseUrl || "http://localhost:11434");
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ollamaModel: modelInput.trim(),
          ollamaBaseUrl: urlInput.trim(),
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        loadSettings();
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch {
      // ignore
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

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0d1117] p-6 lg:p-10 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-zinc-400" />
          <span>System Settings & Data Portability</span>
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Manage local AI configuration, backup your Markdown vault, and import existing Obsidian notes.
        </p>
      </div>

      {/* AI Provider Configuration */}
      <Card className="border-zinc-800 bg-[#161b22]">
        <CardHeader className="border-b border-zinc-800/80 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-blue-400" />
              <CardTitle className="text-base font-semibold text-white">
                AI Engine & Model Configuration
              </CardTitle>
            </div>
            {settings && (
              <Badge variant="secondary" className="text-xs">
                Active: {settings.activeProvider}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">
                Ollama API Base URL
              </label>
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="http://localhost:11434"
                className="bg-zinc-900 border-zinc-700 text-sm font-mono"
              />
              <p className="text-[11px] text-zinc-400 mt-1">
                Default endpoint for your locally running Ollama instance.
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">
                Ollama Model Name
              </label>
              <Input
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                placeholder="llama3.1, mistral, deepseek-r1, or qwen2.5"
                className="bg-zinc-900 border-zinc-700 text-sm font-mono"
              />
              <p className="text-[11px] text-zinc-400 mt-1">
                E.g. <code>llama3.1</code>, <code>qwen2.5-coder</code>, or <code>mistral</code>.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="submit"
                disabled={isSaving}
                className="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white"
              >
                {isSaving ? "Saving..." : "Save AI Preferences"}
              </Button>
              {saveSuccess && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Updated successfully!
                </span>
              )}
            </div>
          </form>
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
            <Badge variant="outline" className="text-[10px] shrink-0">
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
            <Badge variant="outline" className="text-[10px] shrink-0">
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
