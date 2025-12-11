
import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";

export default function LoginPage(){
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [err,setErr]=useState("");

  const login=async(e)=>{
    e.preventDefault();
    setErr("");
    try{
      await signInWithEmailAndPassword(auth,email,password);
    }catch{
      setErr("Invalid credentials");
    }
  };

  return(
    <div style={{display:"flex",justifyContent:"center",alignItems:"center",height:"100vh"}}>
      <form onSubmit={login} style={{background:"white",padding:20,borderRadius:8}}>
        <h2>BLCS Login</h2>
        {err && <p style={{color:"red"}}>{err}</p>}
        <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/><br/><br/>
        <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/><br/><br/>
        <button>Login</button>
      </form>
    </div>
  );
}
