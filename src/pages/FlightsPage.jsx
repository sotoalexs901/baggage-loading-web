
export default function FlightsPage({ onFlightSelected }){
  const flights = [
    {id:"FL001", flightNumber:"SY214", date:"2025-01-02"},
    {id:"FL002", flightNumber:"SY310", date:"2025-01-02"}
  ];

  return(
    <div>
      <h2>Select Flight</h2>
      {flights.map(f=>(
        <button key={f.id} onClick={()=>onFlightSelected(f.id)}>
          {f.flightNumber} - {f.date}
        </button>
      ))}
    </div>
  );
}
