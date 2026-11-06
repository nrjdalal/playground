import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "ln of a variable after a file sourced as if's condition",
        "if source /tmp/f; then :; fi; ln -s $X",
      ],
      [
        "ln of a variable after a file sourced as elif's condition",
        "if false; then :; elif source /tmp/f; then :; fi; ln -s $X",
      ],
      [
        "ln of a variable after a file sourced as while's condition",
        "while source /tmp/f; do break; done; ln -s $X",
      ],
      [
        "ln of a variable after a file sourced as until's condition",
        "until source /tmp/f; do :; done; ln -s $X",
      ],
      ["ln of a variable after a file sourced under !", "! source /tmp/f; ln -s $X"],
      ["ln of a variable after a file sourced under time", "time source /tmp/f; ln -s $X"],
      ["ln of a variable after a file sourced under noglob", "noglob source /tmp/f; ln -s $X"],
      [
        "ln of a variable after a file sourced under nocorrect",
        "nocorrect source /tmp/f; ln -s $X",
      ],
      [
        "ln of a variable after a file sourced with an assignment prefix",
        "A=1 source /tmp/f; ln -s $X",
      ],
      ["ln of a variable after a file sourced by a quoted source", "'source' /tmp/f; ln -s $X"],
      ["ln of a variable after a file sourced by an escaped source", "\\source /tmp/f; ln -s $X"],
      [
        "ln of a variable after a file sourced by a source spelled across quotes",
        `s"our"ce /tmp/f; ln -s $X`,
      ],
      ["ln of a variable after a file sourced under eval", "eval source /tmp/f; ln -s $X"],
      [
        "ln of a variable after a file sourced in a case arm",
        "case a in a) source /tmp/f;; esac; ln -s $X",
      ],
      [
        "ln of a variable after a file sourced in then right after a [[ test",
        "if [[ -n x ]] then source /tmp/f; fi; ln -s $X",
      ],
      [
        "ln of a variable after a file sourced in do right after a [[ test",
        "while [[ -n x ]] do source /tmp/f; break; done; ln -s $X",
      ],
      [
        "ln of a variable after a file sourced in until's do right after a [[ test",
        "until [[ -z x ]] do source /tmp/f; break; done; ln -s $X",
      ],
      [
        "ln of a variable after a file dot-sourced in elif's then right after a [[ test",
        "if [[ -z x ]] then :; elif [[ -n x ]] then . /tmp/f; fi; ln -s $X",
      ],
      [
        "ln of a variable after a file sourced as if's short body after a [[ test",
        "if [[ -n x ]] source /tmp/f; ln -s $X",
      ],
      [
        "ln of a variable after a file sourced as if's condition in zsh -c",
        `zsh -c 'if source /tmp/f; then :; fi; ln -s $X'`,
      ],
    ],
  },
  {
    // in the home folder the guard already refuses `.`, which it reads as a path naming the folder that holds the extensions root
    folders: ["checkout"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "ln of a variable after a file dot-sourced as if's condition",
        "if . /tmp/f; then :; fi; ln -s $X",
      ],
    ],
  },
]
