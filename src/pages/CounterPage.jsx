
import { useState } from "react";

export default function CounterPage({ flightId }){
  const [total,setTotal]=useState("");

  return(
    <div>
      <h2>Counter - {flightId}</h2>
      <input type="number" placeholder="Checked bags total" value={total} onChange={e=>setTotal(e.target.value)}/>
    </div>
  );
}
