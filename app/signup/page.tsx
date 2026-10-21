import type {Metadata} from "next";
import AuthForm from "@/components/AuthForm";
export const metadata:Metadata={title:"Create account",robots:{index:false,follow:false}};
export default function Signup(){return <AuthForm key="signup" mode="signup"/>;}
