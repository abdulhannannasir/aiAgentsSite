/**
 * Holographic headline text: a moving cyan -> violet -> magenta gradient clipped to the letters, with two faint
 * chromatic "ghost" copies (CSS pseudo-elements, see index.css) that glitch sideways now and then. Split per word so
 * long phrases still wrap. The DOM holds the phrase exactly once.
 */
export function HoloText({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, i, all) => (
        <span key={i}>
          <span className="holo" data-text={word}>
            <span className="holo-base">{word}</span>
          </span>
          {i < all.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}
