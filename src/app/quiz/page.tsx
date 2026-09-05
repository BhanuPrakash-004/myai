"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RotateCcw,
  ArrowRight,
  Brain,
  Award,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface QuizQuestion {
  id: string;
  memoryId?: string;
  type: string;
  topic: string;
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
}

export default function QuizPage() {
  const [topic, setTopic] = useState("All");
  const [questionCount, setQuestionCount] = useState(5);
  const [sessionId, setSessionId] = useState("");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [selectedAnswer, setSelectedAnswer] = useState<string>("");
  const [evaluation, setEvaluation] = useState<{ isCorrect: boolean; explanation: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [score, setScore] = useState(0);

  const startQuiz = async () => {
    setIsLoading(true);
    setIsFinished(false);
    setCurrentIndex(0);
    setScore(0);
    setEvaluation(null);
    setSelectedAnswer("");

    try {
      const res = await fetch(`/api/quiz?topic=${encodeURIComponent(topic)}&count=${questionCount}`);
      const data = await res.json();
      setSessionId(data.sessionId);
      setQuestions(data.questions || []);
      setIsStarted(true);
    } catch {
      setQuestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!selectedAnswer.trim() || isSubmitting) return;

    const currentQ = questions[currentIndex];
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          question: currentQ,
          answer: selectedAnswer,
        }),
      });

      const result = await res.json();
      setEvaluation(result);
      if (result.isCorrect) {
        setScore((prev) => prev + 1);
      }
    } catch {
      // Fallback local check
      const correct = selectedAnswer.toLowerCase() === currentQ.correctAnswer.toLowerCase();
      setEvaluation({
        isCorrect: correct,
        explanation: currentQ.explanation,
      });
      if (correct) setScore((prev) => prev + 1);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNext = () => {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer("");
      setEvaluation(null);
    } else {
      setIsFinished(true);
    }
  };

  const currentQ = questions[currentIndex];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0d1117] p-6 lg:p-10 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-purple-400" />
          <span>AI Knowledge Quiz & Evaluation</span>
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Questions generated directly from your personal knowledge base to reinforce tricky syntax and algorithms.
        </p>
      </div>

      {!isStarted ? (
        /* Quiz Setup Screen */
        <Card className="border-zinc-800 bg-[#161b22] p-8 max-w-xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Configure Your Quiz</h2>
              <p className="text-xs text-zinc-400">Select topics to test your recall</p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-2">Topic Scope</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {["All", "DSA", "Java", "LeetCode"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTopic(t)}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      topic === t
                        ? "bg-purple-600/20 border-purple-500 text-purple-300 shadow-xs"
                        : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-2">Question Count</label>
              <div className="grid grid-cols-3 gap-2">
                {[3, 5, 10].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setQuestionCount(c)}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      questionCount === c
                        ? "bg-purple-600/20 border-purple-500 text-purple-300 shadow-xs"
                        : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {c} Questions
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={startQuiz}
              disabled={isLoading}
              className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold mt-4"
            >
              {isLoading ? "Generating Questions from Notes..." : "Start AI Quiz"}
            </Button>
          </div>
        </Card>
      ) : isFinished ? (
        /* Finished Results Screen */
        <Card className="border-zinc-800 bg-[#161b22] p-8 text-center max-w-xl mx-auto animate-in zoom-in-95">
          <div className="h-16 w-16 rounded-full bg-purple-950/60 border border-purple-500/40 flex items-center justify-center text-purple-400 mx-auto mb-4">
            <Award className="h-8 w-8" />
          </div>
          <h2 className="text-2xl font-bold text-white">Quiz Completed!</h2>
          <p className="text-sm text-zinc-400 mt-1">Here is how you scored on your personal notes:</p>

          <div className="my-6 p-6 rounded-xl bg-zinc-900/80 border border-zinc-800 inline-block">
            <div className="text-4xl font-black text-purple-400">
              {score} / {questions.length}
            </div>
            <div className="text-xs text-zinc-400 mt-1 font-medium">
              {Math.round((score / questions.length) * 100)}% Accuracy
            </div>
          </div>

          <div className="flex justify-center gap-3">
            <Button
              onClick={() => {
                setIsStarted(false);
                setIsFinished(false);
              }}
              variant="outline"
              className="text-xs"
            >
              Change Topic
            </Button>
            <Button onClick={startQuiz} className="bg-purple-600 hover:bg-purple-700 text-xs">
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Retake Quiz
            </Button>
          </div>
        </Card>
      ) : currentQ ? (
        /* Active Question Card */
        <div className="space-y-6">
          {/* Progress Bar */}
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>
              Question {currentIndex + 1} of {questions.length}
            </span>
            <span>
              Score: <strong className="text-purple-400">{score}</strong>
            </span>
          </div>

          <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
            />
          </div>

          <Card className="border-zinc-800 bg-[#161b22] p-8 shadow-xl">
            <div className="flex items-center gap-2 mb-4">
              <Badge variant="secondary" className="font-mono text-xs">
                {currentQ.topic}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {currentQ.type.replace("_", " ")}
              </Badge>
            </div>

            <h2 className="text-lg font-semibold text-zinc-100 leading-snug mb-6">
              {currentQ.question}
            </h2>

            {/* Options */}
            {currentQ.options && currentQ.options.length > 0 ? (
              <div className="space-y-2.5 mb-6">
                {currentQ.options.map((opt, idx) => {
                  const isSelected = selectedAnswer === opt;
                  return (
                    <button
                      key={idx}
                      onClick={() => !evaluation && setSelectedAnswer(opt)}
                      disabled={Boolean(evaluation)}
                      className={`w-full text-left p-3.5 rounded-lg border text-sm transition-all cursor-pointer ${
                        isSelected
                          ? "bg-purple-600/20 border-purple-500 text-purple-200 font-medium"
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800"
                      }`}
                    >
                      <span className="font-mono text-xs mr-3 text-zinc-400">
                        {String.fromCharCode(65 + idx)}.
                      </span>
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mb-6">
                <input
                  type="text"
                  value={selectedAnswer}
                  onChange={(e) => !evaluation && setSelectedAnswer(e.target.value)}
                  placeholder="Type your answer..."
                  disabled={Boolean(evaluation)}
                  className="w-full h-11 px-4 rounded-lg border border-zinc-700 bg-zinc-900 text-sm text-white"
                />
              </div>
            )}

            {/* Feedback Evaluation */}
            {evaluation && (
              <div
                className={`p-4 rounded-xl border mb-6 animate-in fade-in-50 ${
                  evaluation.isCorrect
                    ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                    : "bg-red-950/40 border-red-800/50 text-red-300"
                }`}
              >
                <div className="flex items-center gap-2 font-semibold text-sm mb-1">
                  {evaluation.isCorrect ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span>Correct!</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-400" />
                      <span>Incorrect</span>
                    </>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-zinc-300 mt-1">
                  {evaluation.explanation}
                </p>
              </div>
            )}

            {/* Action Bar */}
            <div className="flex justify-end">
              {!evaluation ? (
                <Button
                  onClick={handleSubmitAnswer}
                  disabled={!selectedAnswer.trim() || isSubmitting}
                  className="h-10 px-6 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
                >
                  Submit Answer
                </Button>
              ) : (
                <Button
                  onClick={handleNext}
                  className="h-10 px-6 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold gap-1.5"
                >
                  <span>Next Question</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
