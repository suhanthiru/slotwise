import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Resource = { id: string; name: string; category: string; location: string; equipment: string };
type Booking = { id: string; resource: string; hour: number; label: string };
type Schedule = { resources: Resource[]; hours: number[]; bookings: Booking[] };
type Selection = { resource: Resource; hour: number; booking?: Booking };

const today = () => new Date().toISOString().slice(0, 10);
const dayDate = (day: string) => new Date(day + 'T00:00:00Z');
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'long', weekday: 'long', day: 'numeric', timeZone: 'UTC' });
const hourFormat = (hour: number) => (hour % 12 || 12) + ':00 ' + (hour < 12 ? 'AM' : 'PM');

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    throw new Error(details?.error || 'Request failed.');
  }
  return response.status === 204 ? undefined as T : response.json();
}

function App() {
  const [day, setDay] = useState(today);
  const [schedule, setSchedule] = useState<Schedule>();
  const [selection, setSelection] = useState<Selection>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, refresh] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoadError('');
    request<Schedule>('/api/schedule?day=' + day, { signal: controller.signal })
      .then(setSchedule)
      .catch((error: Error) => {
        if (!controller.signal.aborted) setLoadError(error.message);
      });
    return () => controller.abort();
  }, [day, revision]);

  function changeDay(next: string) {
    if (!next || next === day) return;
    setSchedule(undefined);
    setSelection(undefined);
    setFeedback('');
    setDay(next);
  }

  function moveDay(offset: number) {
    const next = dayDate(day);
    next.setUTCDate(next.getUTCDate() + offset);
    changeDay(next.toISOString().slice(0, 10));
  }

  function selectSlot(resource: Resource, hour: number, booking?: Booking) {
    setName('');
    setFeedback('');
    setSelection({ resource, hour, booking });
  }

  async function update(event: FormEvent) {
    event.preventDefault();
    if (!selection || busy) return;
    setBusy(true);
    setFeedback('');
    try {
      if (selection.booking) {
        await request<void>('/api/bookings/' + selection.booking.id, { method: 'DELETE' });
        setFeedback('Reservation cancelled.');
      } else {
        await request<Booking>('/api/bookings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ resource: selection.resource.id, day, hour: selection.hour, label: name }),
        });
        setFeedback('Reservation confirmed.');
      }
      setSelection(undefined);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The reservation could not be updated.');
    } finally {
      setBusy(false);
      refresh((value) => value + 1);
    }
  }

  const reserved = schedule?.bookings.length ?? 0;
  const available = schedule ? schedule.resources.length * schedule.hours.length - reserved : null;

  return <>
    <header className="masthead">
      <div className="frame brand"><span aria-hidden="true" className="mark">S</span><span>Slotwise</span><span className="tagline">Makerspace booking</span></div>
    </header>
    <main className="frame">
      <div className="page-title">
        <div><h1>Resource schedule</h1><p>Find a workbench and reserve an hour for your project.</p></div>
        <button className="subtle" disabled={busy || day === today()} onClick={() => changeDay(today())}>Go to today</button>
      </div>
      <div className="layout">
        <section className="panel" aria-labelledby="schedule-title">
          <div className="toolbar">
            <div><h2 id="schedule-title">{dayFormat.format(dayDate(day))}</h2><span className="muted">{available === null ? 'Times in UTC' : available + ' available · ' + reserved + ' reserved · UTC'}</span></div>
            <div className="date-nav">
              <button className="subtle" aria-label="Previous day" disabled={busy} onClick={() => moveDay(-1)}>‹</button>
              <input aria-label="Schedule date (UTC)" type="date" value={day} disabled={busy} onChange={(event) => changeDay(event.target.value)} />
              <button className="subtle" aria-label="Next day" disabled={busy} onClick={() => moveDay(1)}>›</button>
            </div>
          </div>
          {loadError && <div className="placeholder" role="alert">{loadError} <button className="subtle" onClick={() => refresh((value) => value + 1)}>Retry</button></div>}
          {!schedule && !loadError && <p className="placeholder" role="status">Loading schedule…</p>}
          {schedule && <div className="table-wrap"><table>
            <thead><tr><th scope="col">Time</th>{schedule.resources.map((resource) => <th scope="col" key={resource.id}>
              {resource.name}<span className="muted">{resource.location}</span>
            </th>)}</tr></thead>
            <tbody>{schedule.hours.map((hour) => <tr key={hour}><th scope="row">{hourFormat(hour)}</th>
              {schedule.resources.map((resource) => {
                const booking = schedule.bookings.find((item) => item.resource === resource.id && item.hour === hour);
                const selected = selection?.resource.id === resource.id && selection.hour === hour;
                return <td key={resource.id}><button type="button" className={booking ? 'slot taken' : 'slot open'} aria-pressed={selected}
                  disabled={busy} aria-label={resource.name + ', ' + hourFormat(hour) + ': ' + (booking ? 'Reserved by ' + booking.label : 'Available')}
                  onClick={() => selectSlot(resource, hour, booking)}>{booking?.label ?? 'Available'}</button></td>;
              })}
            </tr>)}</tbody>
          </table></div>}
        </section>
        <aside className="panel details" aria-labelledby="details-title">
          <h2 id="details-title">{selection?.booking ? 'Reservation' : 'Book a slot'}</h2>
          {selection ? <form onSubmit={update}>
            <p className="resource">{selection.resource.name}</p>
            <p className="muted">{selection.resource.location} · {selection.resource.category}</p>
            <p className="muted">{selection.resource.equipment}</p>
            <p className="time">{hourFormat(selection.hour)} – {hourFormat(selection.hour + 1)} UTC</p>
            {selection.booking ? <p>Reserved for {selection.booking.label}</p> : <label>Reservation name
              <input required maxLength={60} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="e.g. Team Finch" />
            </label>}
            <button className={selection.booking ? 'danger' : 'primary'} disabled={busy || (!selection.booking && !name.trim())}>
              {busy ? 'Saving…' : selection.booking ? 'Cancel reservation' : 'Confirm reservation'}
            </button>
          </form> : <p className="muted">Choose a time on the schedule to see its details.</p>}
          <p className="feedback" role="status">{feedback}</p>
        </aside>
      </div>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
