import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { openai, OPENAI_MODEL } from '../lib/openaiClient';

const router = Router();

interface Question {
  id: number;
  question: string;
  options: string[];
  correctAnswer: string;
}

// POST /api/quiz/generate
// Body: { stack, difficulty, count }
router.post('/generate', async (req: Request, res: Response) => {
  const { stack, difficulty, count } = req.body;

  if (!stack || !difficulty || !count) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const prompt = `Generate ${count} multiple-choice quiz questions for a student learning ${stack} at ${difficulty} difficulty level.

Return ONLY valid JSON, no markdown formatting, no code fences, no explanation. Use this exact structure:

{
  "questions": [
    {
      "id": 1,
      "question": "question text",
      "options": ["option A", "option B", "option C", "option D"],
      "correctAnswer": "the exact text of the correct option"
    }
  ]
}

Make sure correctAnswer exactly matches one of the strings in options. Vary the topics covered within ${stack}.`;

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? '';

    // Strip potential markdown code fences just in case the model adds them
    const cleaned = raw.replace(/```json|```/g, '').trim();

    const parsed = JSON.parse(cleaned);
    const questions: Question[] = parsed.questions;

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('AI returned no questions');
    }

    res.json({ stack, difficulty, questions });
  } catch (err) {
    console.error('Quiz generation failed:', err);
    res.status(500).json({ error: 'Failed to generate quiz questions. Please try again.' });
  }
});

// POST /api/quiz/submit
// Body: { authId, stack, difficulty, questions, answers }
router.post('/submit', async (req: Request, res: Response) => {
  const { authId, stack, difficulty, questions, answers } = req.body;

  if (!answers || !questions) {
    return res.status(400).json({ error: 'Missing answers or questions' });
  }

  const results = (questions as Question[])
    .filter((q) => answers[q.id] !== undefined)
    .map((q) => ({
      question: q.question,
      studentAnswer: answers[q.id],
      correctAnswer: q.correctAnswer,
      isCorrect: answers[q.id] === q.correctAnswer,
    }));

  const correctCount = results.filter((r) => r.isCorrect).length;
  const total = results.length;
  const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  // Generate AI feedback based on performance
  let feedback = 'Great effort! Keep practicing to improve further.';
  try {
    const missedQuestions = results.filter((r) => !r.isCorrect);

    const feedbackPrompt = `A student just completed a ${difficulty} level ${stack} quiz and scored ${correctCount}/${total} (${percentage}%).

${
  missedQuestions.length > 0
    ? `They got these questions wrong:\n${missedQuestions
        .map((r) => `- Q: ${r.question}\n  Their answer: ${r.studentAnswer}\n  Correct answer: ${r.correctAnswer}`)
        .join('\n')}`
    : 'They answered everything correctly.'
}

Write a short, encouraging, 2-3 sentence piece of feedback for the student. Mention specific concepts they should review if they missed questions, or congratulate them and suggest a next challenge if they got everything right. Keep it friendly and constructive, not clinical.`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: feedbackPrompt }],
      temperature: 0.7,
    });

    feedback = completion.choices[0]?.message?.content?.trim() || feedback;
  } catch (err) {
    console.error('Feedback generation failed:', err);
    // Fall back to the default feedback string above rather than failing the whole request
  }

  // Save the attempt to the database
  if (authId) {
    const { error } = await supabaseAdmin.from('quiz_attempts').insert({
      auth_id: authId,
      stack,
      difficulty,
      correct_count: correctCount,
      total,
      percentage,
      results,
      feedback,
    });

    if (error) {
      console.error('Failed to save quiz attempt:', error.message);
    }
  }

  res.json({ correctCount, total, percentage, results, feedback });
});

// GET /api/quiz/history/:authId
router.get('/history/:authId', async (req: Request, res: Response) => {
  const { authId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('quiz_attempts')
    .select('*')
    .eq('auth_id', authId)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ attempts: data });
});

export default router;