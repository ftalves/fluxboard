import { useRoute } from './router';
import { HomeView } from './views/HomeView';
import { NotFoundView } from './views/ErrorView';
import { RoomView } from './views/RoomView';

export function App() {
  const route = useRoute();
  switch (route.kind) {
    case 'home':
      return <HomeView />;
    case 'room':
      return <RoomView roomId={route.roomId} />;
    case 'not_found':
      return <NotFoundView />;
  }
}
