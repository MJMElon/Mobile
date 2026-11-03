import BookCover from './BookCover.jsx';
import { CUSTOMER_REFUSAL, CHECK_FAILED, SHOP_URL } from '../lib/auth';

/* The two answers a door gives instead of the portal, drawn the same way on
   index.html, auth.html and every page behind AuthGate:

   kind="customer" — a Sales Web customer. The ONLY thing on screen is the
     refusal; they have already been signed out by the time it is drawn.
   kind="unknown"  — the profile could not be read and this phone holds no
     earlier answer for this person. Nothing is entered and no tile is drawn,
     but the session is kept, so Try again is all it takes once the line is
     back. */
export default function AccessNotice({ kind, onRetry }) {
  if (kind === 'customer') {
    const [before] = CUSTOMER_REFUSAL.split(SHOP_URL);
    return (
      <BookCover house="MJM Nursery" portal="Admin Portal">
        <div className="bk-slip" data-notice="customer">
          <div className="bk-slip-head">Staff only</div>
          <p className="bk-slip-body">
            {before}
            <a href={SHOP_URL}>{SHOP_URL}</a>
          </p>
        </div>
      </BookCover>
    );
  }
  return (
    <BookCover house="MJM Nursery" portal="Admin Portal">
      <div className="bk-slip" data-notice="unknown">
        <div className="bk-slip-head">Could not check</div>
        <p className="bk-slip-body">{CHECK_FAILED}</p>
        <div className="bk-slip-acts">
          <button className="bk-link" data-retry onClick={onRetry}>Try again</button>
        </div>
      </div>
    </BookCover>
  );
}
