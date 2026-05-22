export type RoomViewProps = { roomId: string };

export function RoomView({ roomId }: RoomViewProps) {
  return (
    <div data-testid="room-view" data-room-id={roomId}>
      Room: {decodeURIComponent(roomId)}
    </div>
  );
}
