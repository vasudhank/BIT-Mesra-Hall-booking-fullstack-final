function extractJSON(str) {
  if (!str) return null;

  // Try to find the first '{' and the last '}'
  const firstOpen = str.indexOf('{');
  const lastClose = str.lastIndexOf('}');

  if (firstOpen === -1 || lastClose === -1 || lastClose < firstOpen) {
    // If no JSON braces found, it's likely just a plain string response
    return null;
  }

  let candidate = str.substring(firstOpen, lastClose + 1);

  try {
    return JSON.parse(candidate);
  } catch (e) {
    // Attempt cleaning common LLM errors
    try {
      let cleaned = candidate
        .replace(/\n/g, "\\n") // Escape newlines
        .replace(/\r/g, "\\r") 
        .replace(/,\s*}/g, '}') // Remove trailing commas
        .replace(/,\s*]/g, ']');
      
      return JSON.parse(cleaned);
    } catch (e2) {
      console.error("Failed to parse AI JSON:", e2.message);
      return null;
    }
  }
}

module.exports = { extractJSON };