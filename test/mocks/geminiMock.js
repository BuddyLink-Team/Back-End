/**
 * Mock responses for Google Gemini AI assistant queries.
 */
export const mockGeminiResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: 'Gợi ý hoạt động cuối tuần: Đi công viên Cầu Ánh Sao dạo bộ và chơi xếp hình Lego.',
          },
        ],
      },
    },
  ],
};

export const DEFAULT_USAGE = Object.freeze({ promptTokens: 120, completionTokens: 30, totalTokens: 150 });

/**
 * geminiAdapter.generateContent result with a text answer
 * @param {string} text
 * @param {Object} [usage]
 */
export const geminiText = (text, usage = DEFAULT_USAGE) => ({
  text,
  functionCalls: [],
  content: { role: 'model', parts: [{ text }] },
  usage,
  model: 'gemini-mock',
});

/**
 * geminiAdapter.generateContent result asking for tool calls
 * @param {Array<{ name: string, args?: Object }>|string} calls - One tool name, or several calls
 * @param {Object} [args] - Arguments when `calls` is a tool name
 * @param {Object} [usage]
 */
export const geminiToolCall = (calls, args = {}, usage = DEFAULT_USAGE) => {
  const list = typeof calls === 'string' ? [{ name: calls, args }] : calls;
  const functionCalls = list.map((call, index) => ({ id: `call-${call.name}-${index}`, name: call.name, args: call.args || {} }));
  return {
    text: '',
    functionCalls,
    content: { role: 'model', parts: functionCalls.map((call) => ({ functionCall: call })) },
    usage,
    model: 'gemini-mock',
  };
};

export default { mockGeminiResponse, geminiText, geminiToolCall, DEFAULT_USAGE };
