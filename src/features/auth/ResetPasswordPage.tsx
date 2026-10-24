import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { resetPasswordSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const form = useForm<{ password: string; confirmPassword: string }>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (values: { password: string }) => {
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      toast.error(errMsg(error));
      return;
    }
    toast.success("Password updated.");
    navigate("/dashboard", { replace: true });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Set a new password</CardTitle>
        <CardDescription>Choose a strong password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="At least 8 characters" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              <KeyRound /> Update password
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
