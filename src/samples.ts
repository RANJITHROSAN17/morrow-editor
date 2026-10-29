export const PYTHON_SAMPLE = `# Welcome to Morrow.
# A little space for big ideas, notes, and code.

from dataclasses import dataclass


@dataclass
class Note:
    title: str
    body: str
    tags: list[str]

    def preview(self, length: int = 60) -> str:
        """Make the important bits easy to find."""
        return self.body[:length].strip() + "…"


def find_notes(notes: list[Note], query: str) -> list[Note]:
    """Find a little clarity, one note at a time."""
    query = query.casefold()
    return [note for note in notes if query in note.title.casefold()]


if __name__ == "__main__":
    notes = [
        Note(
            title="A fresh start",
            body="Every good idea starts somewhere.",
            tags=["ideas", "inspiration"],
        )
    ]

    for note in find_notes(notes, "fresh"):
        print(note.preview())
`;

export const MARKDOWN_SAMPLE = `# A little space for big ideas

Welcome to Morrow, your simple text editor for notes, code, and everything in between.

## Get started

- Create a new file with Ctrl+N.
- Open a text or code file with Ctrl+O.
- Save your work with Ctrl+S.
- Search or replace with Ctrl+F or Ctrl+H.
- Change the language from the toolbar above the editor.

## Your work is yours

Morrow does not send your files anywhere by default. You can opt in to suggestions through Ollama running on your computer.

These are example files. Edit them, or start with a fresh page.
`;
