function isGoodbye(text = "") {
    const t = text.toLowerCase();
    return (
      t.includes("goodbye") ||
      /\bbye\b/.test(t)
    );
  }
  console.log(isGoodbye("goodbye"));