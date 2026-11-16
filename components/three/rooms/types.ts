/** What every room gets. Rooms are built around the table at the origin; table top at y = 0, floor at y = −7.4. */
export interface RoomProps {
  /** radius of the card table, so a room can keep its furniture clear of it */
  tableRadius: number;
  /** how far from the centre the chairs reach, so a room can leave them space */
  reach: number;
  /** small screens get fewer lights and objects */
  mobile: boolean;
}
