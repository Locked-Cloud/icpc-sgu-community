import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { LogIn } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { signInSchema, type SignInValues } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: SignInValues) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error) {
      toast.error(error.message.includes("Invalid login")
        ? "Invalid email or password"
        : errMsg(error));
      return;
    }
    toast.success("Welcome back!");
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from !== "/login" ? from : "/dashboard", { replace: true });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Welcome back to the Level 1 platform.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@example.com" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              <LogIn /> Sign in
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="flex flex-col items-center gap-2 text-sm">
        <p className="text-muted-foreground">
          New to the community?{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
        <Link to="/forgot-password" className="text-xs text-muted-foreground hover:underline">
          Forgot your password?
        </Link>
      </CardFooter>
    </Card>
  );
}
