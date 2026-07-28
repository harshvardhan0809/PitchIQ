import { IntelBoard } from './IntelBoard'
import { fetchCaptainPicks } from '../../services/intelligenceApi'

export function CaptainPicks({ league = 'PL' }) {
  return (
    <IntelBoard
      eyebrow="AI Captain Intelligence"
      title="Who to captain"
      subtitle="Every captain candidate ranked by projected points and ceiling, with the fixture, form and minutes reasoning behind each call."
      boardLabel="captain board"
      fetcher={fetchCaptainPicks}
      league={league}
    />
  )
}
