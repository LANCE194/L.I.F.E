/**
 * L.I.F.E. CPR Guide
 * The adult CPR sequence the Live Session checklist follows, what the camera measures,
 * and notes for children and infants. Content lives in cpr/protocol.ts.
 */

import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { CheckCircleIcon, CloseIcon, WarningIcon } from '../components/icons';
import { ADULT_SEQUENCE, CHILD_INFANT_NOTES, CYCLE_FACTS, EMERGENCY_NUMBER, MEASURED_BY_LIFE, PROTOCOL_SOURCE, RATIO_TABLE } from '../cpr/protocol';
import './CprGuidePage.css';

export function CprGuidePage() {
  return (
    <div className="cpr-guide">
      <PageHeader
        title="Adult CPR Guide"
        subtitle="The sequence trainees practise in L.I.F.E., in this order, following the 2025 American Heart Association guidelines. Each session ends with a procedure checklist."
        actions={<Link to="/live" className="btn btn-primary">Start a practice session</Link>}
      />

      <div className="guide-emergency" role="note">
        <span className="guide-emergency-number">{EMERGENCY_NUMBER}</span>
        <span>Philippine emergency hotline. Call first, or have someone call while you start CPR.</span>
      </div>

      <ol className="guide-steps">
        {ADULT_SEQUENCE.map((step, index) => (
          <li key={step.title} className="guide-step">
            <div className="guide-step-number" aria-hidden="true">{index + 1}</div>
            <div className="guide-step-body">
              <h2>{step.title}</h2>
              <ul>
                {step.points.map(point => <li key={point}>{point}</li>)}
              </ul>
            </div>
          </li>
        ))}
      </ol>

      <section className="card guide-ratio">
        <div className="card-header"><h2 className="card-title">Compressions to breaths: one cycle</h2></div>
        <div className="card-body guide-ratio-body">
          <table className="table guide-ratio-table">
            <caption>Compression-to-breath ratio</caption>
            <thead>
              <tr><th scope="col">Victim</th><th scope="col">1 rescuer</th><th scope="col">2 rescuers</th></tr>
            </thead>
            <tbody>
              {RATIO_TABLE.map(row => (
                <tr key={row.victim}>
                  <th scope="row">{row.victim}</th>
                  <td><span className="ratio-cell">{row.oneRescuer}</span></td>
                  <td><span className={`ratio-cell ${row.twoRescuers === '15:2' ? 'alt' : ''}`}>{row.twoRescuers}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="guide-facts">
            {CYCLE_FACTS.map(fact => <li key={fact}>{fact}</li>)}
          </ul>
        </div>
      </section>

      <div className="guide-grid">
        <section className="card">
          <div className="card-header"><h2 className="card-title">What L.I.F.E. checks</h2></div>
          <div className="card-body">
            <ul className="guide-measure-list">
              {MEASURED_BY_LIFE.map(entry => (
                <li key={entry.item} className={entry.measured ? 'measured' : 'observed'}>
                  {entry.measured ? <CheckCircleIcon size={18} /> : <CloseIcon size={18} />}
                  <span>{entry.item}</span>
                  <small>{entry.measured ? 'Measured by the camera' : 'Trainer observes'}</small>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card">
          <div className="card-header"><h2 className="card-title">Children and infants</h2></div>
          <div className="card-body">
            <ul className="guide-notes">
              {CHILD_INFANT_NOTES.map(note => <li key={note}>{note}</li>)}
            </ul>
          </div>
        </section>
      </div>

      <div className="disclaimer guide-disclaimer">
        <WarningIcon size={20} />
        <div>
          <strong>A quick overview, not a substitute for hands-on training.</strong>
          <p>
            Source: {PROTOCOL_SOURCE}. For certification, take a course from the Philippine Red Cross, the American Heart
            Association or the Red Cross. L.I.F.E. is a training aid only and not a medical device.
          </p>
        </div>
      </div>
    </div>
  );
}

export default CprGuidePage;
