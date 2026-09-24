import { Extension, textInputRule } from '@tiptap/core';

/**
 * Emoji Replacer Extension
 * Automatically replaces text emoticons with emoji characters
 */
export const EmojiReplacer = Extension.create({
  name: 'emojiReplacer',

  addInputRules() {
    return [
      // Smileys
      textInputRule({ find: /:-\) $/, replace: '🙂 ' }),
      textInputRule({ find: /:\) $/, replace: '🙂 ' }),
      textInputRule({ find: /:-D $/, replace: '😃 ' }),
      textInputRule({ find: /:D $/, replace: '😃 ' }),
      textInputRule({ find: /;-\) $/, replace: '😉 ' }),
      textInputRule({ find: /;\) $/, replace: '😉 ' }),
      textInputRule({ find: /:-P $/, replace: '😛 ' }),
      textInputRule({ find: /:P $/, replace: '😛 ' }),
      textInputRule({ find: /:-\( $/, replace: '😞 ' }),
      textInputRule({ find: /:\( $/, replace: '😞 ' }),
      textInputRule({ find: /:'\( $/, replace: '😢 ' }),
      textInputRule({ find: /:-O $/, replace: '😮 ' }),
      textInputRule({ find: /:O $/, replace: '😮 ' }),
      textInputRule({ find: /B-\) $/, replace: '😎 ' }),
      textInputRule({ find: /B\) $/, replace: '😎 ' }),
      textInputRule({ find: /:-\* $/, replace: '😘 ' }),
      textInputRule({ find: /:\* $/, replace: '😘 ' }),
      textInputRule({ find: />:-\( $/, replace: '😠 ' }),
      textInputRule({ find: /:@ $/, replace: '😠 ' }),
      textInputRule({ find: /O:-\) $/, replace: '😇 ' }),
      // Hearts
      textInputRule({ find: /<3 $/, replace: '❤️ ' }),
      textInputRule({ find: /<\/3 $/, replace: '💔 ' }),
      // Symbols
      textInputRule({ find: /\/shrug $/, replace: '¯\\_(ツ)_/¯ ' }),
      textInputRule({ find: /\(y\) $/, replace: '👍 ' }),
      textInputRule({ find: /\(n\) $/, replace: '👎 ' }),
      textInputRule({ find: /:fire: $/, replace: '🔥 ' }),
      textInputRule({ find: /:star: $/, replace: '⭐ ' }),
      textInputRule({ find: /:check: $/, replace: '✅ ' }),
      textInputRule({ find: /:x: $/, replace: '❌ ' }),
      textInputRule({ find: /:warning: $/, replace: '⚠️ ' }),
      textInputRule({ find: /:info: $/, replace: 'ℹ️ ' }),
      textInputRule({ find: /:bulb: $/, replace: '💡 ' }),
      textInputRule({ find: /:rocket: $/, replace: '🚀 ' }),
    ];
  },
});
